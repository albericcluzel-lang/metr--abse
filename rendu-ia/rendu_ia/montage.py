"""Montage des vidéos bout à bout, avec un fondu entre chacune, par ffmpeg sur le PC (gratuit).
Une image fixe y devient un plan avec un lent zoom : de quoi enchaîner les rendus sans modèle vidéo.

ffmpeg vient du module imageio-ffmpeg, qui l'embarque pour Windows, macOS et Linux : rien à installer
à part les dépendances du projet.
"""
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

from .config import ConfigError
from .projet import IMAGE_SUFFIXES

DEFAULT_FPS = 24.0   # cadence de Veo, utilisée si ffmpeg ne l'indique pas ou s'il n'y a que des images
MAX_SIDE = 1920      # montage en Full HD au plus, comme les vidéos de Flow en 1080p
ZOOM = 0.08          # agrandissement au cours d'un plan tiré d'une image fixe


@dataclass(frozen=True)
class Clip:
    path: Path
    seconds: float
    width: int
    height: int
    fps: float | None   # None : image fixe

    @property
    def still(self) -> bool:
        return self.fps is None


def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
    except ImportError as exc:
        raise ConfigError("Le montage a besoin du module imageio-ffmpeg : pip install -r requirements.txt") from exc
    return imageio_ffmpeg.get_ffmpeg_exe()


def probe(ffmpeg: str, path: Path) -> Clip:
    """Durée, taille et cadence d'une vidéo, lues dans ce qu'affiche « ffmpeg -i »."""
    info = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True,
                          encoding="utf-8", errors="replace").stderr
    duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", info)
    line = re.search(r"Stream #.*Video:.*", info)
    size = line and re.search(r"\b(\d{2,5})x(\d{2,5})\b", line.group(0))
    if not duration or not size:
        raise ConfigError(f"Vidéo illisible : {path}")
    hours, minutes, seconds = duration.groups()
    fps = re.search(r"(\d+(?:\.\d+)?) fps", line.group(0))
    return Clip(path, int(hours) * 3600 + int(minutes) * 60 + float(seconds),
                int(size.group(1)), int(size.group(2)), float(fps.group(1)) if fps else DEFAULT_FPS)


def still(path: Path, seconds: float) -> Clip:
    with Image.open(path) as opened:
        width, height = ImageOps.exif_transpose(opened).size
    return Clip(path, seconds, width, height, None)


def output_size(clips: list[Clip]) -> tuple[int, int]:
    """Format de l'entrée la plus étroite : les plus larges ont des bandes noires en haut et en bas, comme
    au cinéma, plutôt que sur les côtés. Largeur de la plus large, Full HD au plus, en nombres pairs."""
    narrowest = min(clips, key=lambda clip: clip.width / clip.height)
    width = max(clip.width for clip in clips)
    height = width * narrowest.height / narrowest.width
    ratio = min(1.0, MAX_SIDE / max(width, height))
    return round(width * ratio / 2) * 2, round(height * ratio / 2) * 2


def clip_filter(index: int, clip: Clip, width: int, height: int, fps: float) -> str:
    """Mise au format commun d'une entrée. Une image fixe reçoit un lent zoom, avant ou arrière une fois
    sur deux ; elle est d'abord agrandie pour que le zoom ne tremble pas."""
    fit = "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    if clip.still:
        frames = round(clip.seconds * fps)
        zoom = (f"1+{ZOOM}*on/{frames}" if index % 2 == 0 else f"{1 + ZOOM}-{ZOOM}*on/{frames}")
        steps = (fit.format(w=width * 2, h=height * 2) + f",zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)'"
                 f":y='ih/2-(ih/zoom/2)':d={frames}:s={width}x{height}:fps={fps:g}")
    else:
        steps = fit.format(w=width, h=height) + f",fps={fps:g}"
    return f"[{index}:v]{steps},format=yuv420p,settb=AVTB[v{index}]"


def assemble(paths: list[Path], target: Path, fade: float, image_seconds: float = 4.0) -> tuple[list[Clip], float]:
    """Met les vidéos et les images bout à bout dans `target`, sans le son.
    Rend les entrées lues et la durée du montage."""
    ffmpeg = ffmpeg_exe()
    clips = [still(path, image_seconds) if path.suffix.lower() in IMAGE_SUFFIXES else probe(ffmpeg, path)
             for path in paths]
    width, height = output_size(clips)
    videos = [clip for clip in clips if not clip.still]
    fps = max(videos, key=lambda clip: clip.width * clip.height).fps if videos else DEFAULT_FPS
    # Un fondu plus long que le tiers d'une vidéo en mangerait l'essentiel.
    fade = min(fade, min(clip.seconds for clip in clips) / 3) if len(clips) > 1 else 0
    graph = [clip_filter(index, clip, width, height, fps) for index, clip in enumerate(clips)]
    if fade > 0:
        last, offset = "v0", 0.0
        for index in range(1, len(clips)):
            offset += clips[index - 1].seconds - fade   # le fondu commence avant la fin de la vidéo précédente
            graph.append(f"[{last}][v{index}]xfade=transition=fade:duration={fade:.3f}:offset={offset:.3f}[x{index}]")
            last = f"x{index}"
    else:
        graph.append("".join(f"[v{index}]" for index in range(len(clips))) + f"concat=n={len(clips)}:v=1:a=0[x]")
        last = "x"
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.name}.{os.getpid()}.tmp")
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
    for clip in clips:
        command += ["-i", str(clip.path)]
    command += ["-filter_complex", ";".join(graph), "-map", f"[{last}]", "-an", "-c:v", "libx264", "-crf", "18",
                "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4", str(temporary)]
    result = subprocess.run(command, capture_output=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        temporary.unlink(missing_ok=True)
        raise ConfigError(f"ffmpeg n'a pas pu faire le montage : {result.stderr.strip()[-600:]}")
    os.replace(temporary, target)
    return clips, sum(clip.seconds for clip in clips) - fade * (len(clips) - 1)
