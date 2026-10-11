"""Les étapes du workflow, dans l'ordre de la vidéo de référence :
essais -> image maître -> rendus -> storyboard -> upscale -> vidéo.

Chaque étape prépare une liste de travaux. Un travail dont le résultat existe déjà est sauté : après
une panne ou un refus, relancer la commande ne paie que ce qui manque. Un résultat plus ancien que ses
images de départ (capture réexportée, nouvelle image maître, rendu refait) est refait.
"""
from __future__ import annotations

import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import prompts
from .config import ConfigError, FatalError, Settings
from .projet import IMAGE_SUFFIXES, MAX_REFERENCES, VIDEO_SUFFIXES, Project, find_output, reference_label, write_atomic
from .prompts import Shot
from .service import Fal, ServiceError, media_urls

VISION_ENDPOINT = "openrouter/router/vision"


@dataclass
class Job:
    label: str
    targets: list[Path]                # fichiers produits, sans extension
    suffixes: tuple[str, ...]
    run: Callable[[Fal], list[Path]]
    sources: list[Path] = field(default_factory=list)   # images de départ

    def done(self) -> bool:
        newest = max((source.stat().st_mtime for source in self.sources if source.is_file()), default=0.0)
        for target in self.targets:
            found = find_output(target, self.suffixes)
            if found is None or found.stat().st_mtime < newest:
                return False
        return True


@dataclass
class Report:
    produced: list[Path] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    aborted: str | None = None


def pending(jobs: list[Job], redo: bool) -> list[Job]:
    return list(jobs) if redo else [job for job in jobs if not job.done()]


def execute(jobs: list[Job], fal: Fal, parallel: int, out: Callable[[str], None]) -> Report:
    """Lance les travaux, plusieurs à la fois. Une erreur qui toucherait tous les travaux (clé
    refusée, crédit épuisé) arrête ceux qui n'ont pas encore commencé."""
    report = Report()
    stop = threading.Event()

    def guarded(job: Job) -> list[Path] | None:
        return None if stop.is_set() else job.run(fal)

    with ThreadPoolExecutor(max_workers=parallel) as pool:
        futures = {pool.submit(guarded, job): job for job in jobs}
        for future in as_completed(futures):
            job = futures[future]
            try:
                files = future.result()
            except FatalError as exc:
                stop.set()
                report.aborted = report.aborted or str(exc)
                continue
            except Exception as exc:  # un travail raté ne doit pas faire perdre ceux qui ont réussi
                message = str(exc) if isinstance(exc, ServiceError) else f"{type(exc).__name__} : {exc}"
                report.errors.append(f"{job.label} : {message}")
                out(f"[ERREUR] {job.label} : {message}")
                continue
            if files is not None:
                report.produced += files
                out(f"[ok] {job.label} -> {', '.join(file.name for file in files)}")
    return report


# --- Génération d'images -------------------------------------------------------------------------

def generate_images(fal: Fal, settings: Settings, prompt: str, inputs: list[Path], targets: list[Path]) -> list[Path]:
    arguments = {
        "prompt": prompt,
        "image_urls": [fal.upload(path) for path in inputs],
        "num_images": len(targets),
        "resolution": settings.resolution,
        "aspect_ratio": settings.aspect_ratio,
        "output_format": "png",
        **settings.image_options,
    }
    result = fal.run(settings.image_model, arguments, kind="image")
    urls = media_urls(result)
    if len(urls) < len(targets):
        note = f" Réponse du modèle : {result['description']}" if result.get("description") else ""
        raise ServiceError(f"{len(urls)} image(s) reçue(s) sur {len(targets)} demandée(s).{note}")
    return [fal.download(url, target) for url, target in zip(urls, targets)]


def render_inputs(project: Project, capture: Path, master: Path | None) -> tuple[list[Path], list[str]]:
    """Images envoyées pour une vue (capture, image maître, références) et noms des références."""
    references = project.references()[:MAX_REFERENCES]
    inputs = [capture] + ([master] if master else []) + references
    return inputs, [reference_label(path) for path in references]


def numbered(base: Path, count: int) -> list[Path]:
    return [base] if count == 1 else [base.with_name(f"{base.name}_{index}") for index in range(1, count + 1)]


def essais_jobs(project: Project, settings: Settings, capture: Path, count: int, people: bool) -> list[Job]:
    """Plusieurs propositions d'une même vue, pour valider la direction avec le client."""
    inputs, labels = render_inputs(project, capture, None)
    prompt = prompts.render_prompt(master=False, references=labels, brief=project.brief(), people=people)
    targets = [project.output / "essais" / f"{capture.stem}_{index}" for index in range(1, count + 1)]
    return [Job(f"essais {capture.name} ({count} image(s))", targets, IMAGE_SUFFIXES,
                lambda fal: generate_images(fal, settings, prompt, inputs, targets), [capture])]


def rendus_jobs(project: Project, settings: Settings, captures: list[Path], variants: int, people: bool) -> list[Job]:
    """Toutes les vues, avec l'image maître comme référence de style pour qu'elles se ressemblent."""
    master = project.master()
    jobs = []
    for capture in captures:
        inputs, labels = render_inputs(project, capture, master)
        prompt = prompts.render_prompt(master=master is not None, references=labels, brief=project.brief(),
                                       people=people)
        targets = numbered(project.output / "rendus" / capture.stem, variants)
        jobs.append(Job(f"rendu {capture.name}", targets, IMAGE_SUFFIXES,
                        lambda fal, prompt=prompt, inputs=inputs, targets=targets:
                        generate_images(fal, settings, prompt, inputs, targets),
                        [capture] + ([master] if master else [])))
    return jobs


def lock_master(project: Project, image: Path) -> list[Path]:
    """Verrouille l'image maître. Si elle vient des essais, elle devient aussi le rendu de sa vue."""
    if not image.is_file():
        raise ConfigError(f"Image introuvable : {image}")
    data = image.read_bytes()  # lue avant d'effacer l'ancienne image maître, qui peut être la même
    written = [replace_output(project.output / "maitre", image.suffix, data)]
    match = re.fullmatch(r"(.+)_\d+", image.stem)
    if match and image.parent.resolve() == (project.output / "essais").resolve():
        capture = next((path for path in project.captures() if path.stem == match.group(1)), None)
        if capture:
            written.append(replace_output(project.output / "rendus" / capture.stem, image.suffix, data))
    return written


def replace_output(base: Path, suffix: str, data: bytes) -> Path:
    """Remplace le résultat `base` (chemin sans extension), quelle que soit l'extension de l'ancien.
    Un fichier identique n'est pas réécrit : sa date ne change pas, rien n'est à refaire derrière."""
    path = base.with_name(base.name + suffix.lower())
    if path.is_file() and path.read_bytes() == data:
        return path
    for old in IMAGE_SUFFIXES:
        base.with_name(base.name + old).unlink(missing_ok=True)
    write_atomic(path, data)
    return path


# --- Storyboard ----------------------------------------------------------------------------------

def storyboard_folder(project: Project, image: Path) -> Path:
    return project.output / "storyboard" / image.stem


def write_storyboard(fal: Fal, settings: Settings, image: Path, count: int) -> list[Shot]:
    """Le modèle de texte regarde l'image et écrit les plans (le nœud « Assistant » de la vidéo)."""
    if settings.llm_model is None:
        return list(prompts.DEFAULT_SHOTS[:count])
    arguments = {"model": settings.llm_model, "system_prompt": prompts.STORYBOARD_SYSTEM,
                 "prompt": prompts.storyboard_request(count), "image_urls": [fal.upload(image)]}
    text = str(fal.run(VISION_ENDPOINT, arguments, kind="text").get("output", ""))
    try:
        return prompts.parse_storyboard(text, count)
    except ValueError as exc:  # JSONDecodeError en hérite
        raise ServiceError(f"storyboard illisible ({exc}). Réponse reçue : {text[:300]}") from exc


def save_storyboard(folder: Path, image: Path, shots: list[Shot]) -> Path:
    path = folder / "storyboard.json"
    data = {"image": str(image), "plans": [
        {"fichier": f"plan_{index}", "titre": shot.title, "image": shot.image, "mouvement": shot.motion}
        for index, shot in enumerate(shots, start=1)]}
    write_atomic(path, json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))
    return path


def load_storyboard(folder: Path, image: Path | None = None) -> list[Shot] | None:
    """Storyboard enregistré ; None s'il manque ou s'il est plus ancien que `image`."""
    path = folder / "storyboard.json"
    if not path.is_file() or (image is not None and path.stat().st_mtime < image.stat().st_mtime):
        return None
    plans = json.loads(path.read_text(encoding="utf-8"))["plans"]
    return [Shot(plan["titre"], plan["image"], plan["mouvement"]) for plan in plans]


def shot_jobs(settings: Settings, image: Path, folder: Path, shots: list[Shot]) -> list[Job]:
    jobs = []
    for index, shot in enumerate(shots, start=1):
        prompt = prompts.shot_prompt(shot)
        targets = [folder / f"plan_{index}"]
        jobs.append(Job(f"plan {index} : {shot.title}", targets, IMAGE_SUFFIXES,
                        lambda fal, prompt=prompt, targets=targets:
                        generate_images(fal, settings, prompt, [image], targets),
                        [image, folder / "storyboard.json"]))
    return jobs


# --- Upscale et vidéo ----------------------------------------------------------------------------

def output_key(project: Project, path: Path) -> Path:
    """Chemin d'un résultat relatif à « sorties », sans extension ni préfixe « upscale »
    (« sorties/upscale/rendus/salon.png » -> « rendus/salon »)."""
    try:
        relative = path.resolve().relative_to(project.output.resolve())
    except ValueError:
        return Path(path.stem)
    if relative.parts and relative.parts[0] == "upscale":
        relative = Path(*relative.parts[1:])
    return relative.with_suffix("")


def default_upscale_sources(project: Project) -> list[Path]:
    return [path for folder in ("rendus", "storyboard") for path in sorted((project.output / folder).rglob("*"))
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES]


def upscale_jobs(project: Project, settings: Settings, sources: list[Path]) -> list[Job]:
    jobs = []
    for source in sources:
        target = project.output / "upscale" / output_key(project, source)

        def run(fal: Fal, source=source, target=target) -> list[Path]:
            arguments = {"image_url": fal.upload(source, max_side=None),
                         "upscale_factor": settings.upscale_factor, **settings.upscale_options}
            urls = media_urls(fal.run(settings.upscale_model, arguments, kind="upscale"))
            if not urls:
                raise ServiceError("aucune image reçue")
            return [fal.download(urls[0], target)]

        jobs.append(Job(f"upscale {output_key(project, source).as_posix()}", [target], IMAGE_SUFFIXES, run, [source]))
    return jobs


def default_video_sources(project: Project) -> list[Path]:
    """Les plans du storyboard s'il y en a, sinon les rendus ; version upscalée quand elle est à jour."""
    plans = sorted(path for path in (project.output / "storyboard").rglob("plan_*")
                   if path.suffix.lower() in IMAGE_SUFFIXES)
    sources = plans or [path for path in sorted((project.output / "rendus").glob("*"))
                        if path.suffix.lower() in IMAGE_SUFFIXES]
    return [upscaled_version(project, path) or path for path in sources]


def upscaled_version(project: Project, path: Path) -> Path | None:
    """Version upscalée de l'image, si elle existe et n'est pas plus ancienne qu'elle."""
    upscaled = find_output(project.output / "upscale" / output_key(project, path), IMAGE_SUFFIXES)
    return upscaled if upscaled and upscaled.stat().st_mtime >= path.stat().st_mtime else None


def motion_for(project: Project, source: Path) -> str | None:
    """Mouvement de caméra prévu par le storyboard pour ce plan, s'il en vient."""
    key = output_key(project, source)
    match = re.fullmatch(r"plan_(\d+)", key.name)
    if len(key.parts) != 3 or key.parts[0] != "storyboard" or not match:
        return None
    shots = load_storyboard(project.output / key.parent)
    index = int(match.group(1)) - 1
    return shots[index].motion if shots and index < len(shots) else None


def video_jobs(project: Project, settings: Settings, sources: list[Path], motion: str | None) -> list[Job]:
    jobs = []
    for source in sources:
        target = project.output / "videos" / output_key(project, source)
        prompt = prompts.video_prompt(motion or motion_for(project, source))

        def run(fal: Fal, source=source, target=target, prompt=prompt) -> list[Path]:
            arguments = {settings.video.image_field: fal.upload(source), "prompt": prompt,
                         "duration": str(settings.video_seconds), **settings.video.options,
                         **settings.video_options}
            urls = media_urls(fal.run(settings.video.endpoint, arguments, kind="video"))
            if not urls:
                raise ServiceError("aucune vidéo reçue")
            return [fal.download(urls[0], target)]

        jobs.append(Job(f"vidéo {output_key(project, source).as_posix()} ({settings.video_seconds} s)",
                        [target], VIDEO_SUFFIXES, run, [source]))
    return jobs
