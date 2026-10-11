"""Ligne de commande : python -m rendu_ia {nouveau,essais,maitre,rendus,storyboard,upscale,video}."""
from __future__ import annotations

import argparse
import dataclasses
import sys
from pathlib import Path

from . import etapes, prompts
from .config import VIDEO_MODELS, ConfigError, FatalError, Settings, check_video_seconds
from .etapes import Job
from .projet import MAX_REFERENCES, Project
from .service import Fal, ServiceError


def bounded_int(low: int, high: int):
    def parse(value: str) -> int:
        number = int(value)
        if not low <= number <= high:
            raise argparse.ArgumentTypeError(f"doit être un entier entre {low} et {high}")
        return number
    return parse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rendu_ia", description="Rendus photo et vidéo à partir de captures Archicad.")
    commands = parser.add_subparsers(dest="command", required=True)

    nouveau = commands.add_parser("nouveau", help="créer un dossier de projet (captures, références, ambiance)")
    nouveau.add_argument("projet", help="dossier du projet à créer")

    def paid(name: str, help: str) -> argparse.ArgumentParser:
        command = commands.add_parser(name, help=help)
        command.add_argument("projet", help="dossier du projet")
        command.add_argument("--apply", action="store_true", help="lancer réellement (payant) ; sinon simulation")
        command.add_argument("--refaire", action="store_true", help="refaire aussi ce qui existe déjà")
        return command

    essais = paid("essais", "plusieurs propositions d'une vue, pour valider la direction (simulation par défaut)")
    essais.add_argument("--capture", help="vue à essayer (nom du fichier dans « captures »)")
    essais.add_argument("--nombre", type=bounded_int(1, 4), default=4, help="nombre de propositions (4)")
    essais.add_argument("--personnages", action="store_true", help="ajouter une ou deux personnes")

    maitre = commands.add_parser("maitre", help="verrouiller l'image maître qui donne le style aux autres")
    maitre.add_argument("projet", help="dossier du projet")
    maitre.add_argument("image", help="image choisie (en général une des propositions des essais)")

    rendus = paid("rendus", "toutes les vues, dans le style de l'image maître (simulation par défaut)")
    rendus.add_argument("--capture", action="append", help="seulement cette vue (option répétable)")
    rendus.add_argument("--variantes", type=bounded_int(1, 4), default=1, help="images par vue (1)")
    rendus.add_argument("--personnages", action="store_true", help="ajouter une ou deux personnes")

    storyboard = paid("storyboard", "plans cinématiques tirés d'une image (simulation par défaut)")
    storyboard.add_argument("--image", help="image de départ (par défaut l'image maître)")
    storyboard.add_argument("--plans", type=bounded_int(1, 8), default=4, help="nombre de plans (4)")

    upscale = paid("upscale", "agrandir les images (simulation par défaut)")
    upscale.add_argument("fichiers", nargs="*", help="images à agrandir (par défaut rendus et storyboard)")

    video = paid("video", "animer les images (simulation par défaut)")
    video.add_argument("fichiers", nargs="*", help="images à animer (par défaut les plans du storyboard)")
    video.add_argument("--duree", type=int, help="durée de chaque vidéo en secondes")
    video.add_argument("--modele", choices=sorted(VIDEO_MODELS), help="modèle vidéo (par défaut RENDU_MODELE_VIDEO)")
    video.add_argument("--mouvement", help="mouvement de caméra, en anglais (remplace celui du storyboard)")
    return parser


def run_jobs(settings: Settings, jobs: list[Job], args: argparse.Namespace, fal: Fal | None = None,
             extra: int = 0) -> int:
    """Simulation (liste de ce qui serait payé) ou lancement réel avec --apply.

    `extra` : demandes payantes annoncées en plus des travaux (storyboard à écrire).
    """
    todo = etapes.pending(jobs, args.refaire)
    skipped = len(jobs) - len(todo)
    if skipped:
        print(f"{skipped} déjà fait(s), sauté(s) (--refaire pour les refaire).")
    if not todo and not extra:
        print("Rien de nouveau à produire.")
        return 0
    if not args.apply:
        for job in todo:
            print(f"[à faire] {job.label}")
        print(f"Simulation : {len(todo) + extra} demande(s) payante(s) seraient envoyée(s) à fal.ai. "
              "Ajoutez --apply pour lancer.")
        return 0
    own = fal is None
    fal = fal or Fal(settings.fal_key)
    try:
        report = etapes.execute(todo, fal, settings.parallel, lambda line: print(line, flush=True))
    finally:
        if own:
            fal.close()
    if report.produced:
        print(f"{len(report.produced)} fichier(s) produit(s).")
    if report.errors:
        print(f"{len(report.errors)} échec(s) : relancez la même commande, seuls les manquants seront refaits.",
              file=sys.stderr)
    if report.aborted:
        print(f"Erreur : arrêt avant la fin : {report.aborted}", file=sys.stderr)
    return 1 if report.errors or report.aborted else 0


def existing_files(names: list[str]) -> list[Path]:
    paths = [Path(name) for name in names]
    for path in paths:
        if not path.is_file():
            raise ConfigError(f"Fichier introuvable : {path}")
    return paths


def cmd_nouveau(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.create(args.projet)
    print(f"Projet créé : {project.root}\n"
          "  captures\\     vos vues 3D Archicad (une image par point de vue)\n"
          "  references\\   photos de matériaux et d'ambiance, nommées par leur usage\n"
          "  ambiance.txt  l'ambiance voulue, en quelques lignes (facultatif)\n"
          f"Ensuite : python -m rendu_ia essais \"{project.root}\"")
    return 0


def cmd_essais(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.open(args.projet)
    captures = project.captures()
    if args.capture:
        capture = project.find_capture(args.capture)
    elif len(captures) == 1:
        capture = captures[0]
    else:
        names = ", ".join(path.name for path in captures) or "aucune"
        raise ConfigError(f"Précisez la vue avec --capture (captures du projet : {names}).")
    warn_references(project)
    code = run_jobs(settings, etapes.essais_jobs(project, settings, capture, args.nombre, args.personnages), args)
    if args.apply and code == 0:
        print(f"Choisissez la meilleure proposition dans {project.output / 'essais'}, puis :\n"
              f"  python -m rendu_ia maitre \"{project.root}\" <image choisie>")
    return code


def cmd_maitre(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.open(args.projet)
    written = etapes.lock_master(project, Path(args.image))
    print(f"Image maître verrouillée : {written[0]}")
    if len(written) > 1:
        print(f"Elle sert aussi de rendu pour sa vue : {written[1]}")
    print(f"Ensuite : python -m rendu_ia rendus \"{project.root}\"")
    return 0


def cmd_rendus(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.open(args.projet)
    captures = [project.find_capture(name) for name in args.capture] if args.capture else project.captures()
    if not captures:
        raise ConfigError(f"Aucune capture dans {project.root / 'captures'} (PNG, JPG ou WEBP).")
    if project.master() is None:
        print("Attention : pas d'image maître, les vues risquent de ne pas se ressembler. "
              "Conseil : lancer d'abord « essais » puis « maitre ».")
    warn_references(project)
    code = run_jobs(settings, etapes.rendus_jobs(project, settings, captures, args.variantes, args.personnages), args)
    if args.apply and code == 0:
        print(f"Ensuite : python -m rendu_ia storyboard \"{project.root}\"")
    return code


def cmd_storyboard(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.open(args.projet)
    image = Path(args.image) if args.image else project.master()
    if image is None:
        raise ConfigError("Pas d'image maître : verrouillez-en une (commande « maitre ») ou donnez --image.")
    if not image.is_file():
        raise ConfigError(f"Image introuvable : {image}")
    count = args.plans
    if settings.llm_model is None and count > len(prompts.DEFAULT_SHOTS):
        count = len(prompts.DEFAULT_SHOTS)
        print(f"Sans modèle de texte (RENDU_MODELE_LLM=aucun), {count} plans types au plus.")
    folder = etapes.storyboard_folder(project, image)
    shots = None if args.refaire else etapes.load_storyboard(folder, image)
    if shots is not None:
        print(f"Storyboard existant réutilisé ({len(shots)} plans) : {folder / 'storyboard.json'}")
    elif not args.refaire and (folder / "storyboard.json").is_file():
        print("L'image de départ a changé depuis le storyboard : il sera réécrit et ses plans refaits.")

    if shots is not None:
        code = run_jobs(settings, etapes.shot_jobs(settings, image, folder, shots), args)
    elif not args.apply:
        writer = settings.llm_model or "plans types, sans modèle de texte"
        print(f"[à faire] écrire le storyboard de {count} plans ({writer})")
        placeholders = [prompts.Shot("plan à écrire", "", "") for _ in range(count)]
        code = run_jobs(settings, etapes.shot_jobs(settings, image, folder, placeholders), args,
                        extra=1 if settings.llm_model else 0)
    else:
        fal = Fal(settings.fal_key)
        try:
            print("Écriture du storyboard...", flush=True)
            shots = etapes.write_storyboard(fal, settings, image, count)
            etapes.save_storyboard(folder, image, shots)
            for index, shot in enumerate(shots, start=1):
                print(f"  plan {index} : {shot.title}\n      image : {shot.image}\n      mouvement : {shot.motion}")
            code = run_jobs(settings, etapes.shot_jobs(settings, image, folder, shots), args, fal)
        finally:
            fal.close()
    if args.apply and code == 0:
        print(f"Plans dans {folder}. Ensuite : python -m rendu_ia upscale \"{project.root}\"")
    return code


def cmd_upscale(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.open(args.projet)
    sources = existing_files(args.fichiers) if args.fichiers else etapes.default_upscale_sources(project)
    if not sources:
        raise ConfigError("Aucune image à agrandir : lancez d'abord « rendus » ou « storyboard ».")
    code = run_jobs(settings, etapes.upscale_jobs(project, settings, sources), args)
    if args.apply and code == 0:
        print(f"Ensuite : python -m rendu_ia video \"{project.root}\"")
    return code


def cmd_video(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.open(args.projet)
    if args.modele:
        settings = dataclasses.replace(settings, video_name=args.modele, video=VIDEO_MODELS[args.modele])
    if args.duree is not None:
        settings = dataclasses.replace(settings, video_seconds=args.duree)
    check_video_seconds(settings.video, settings.video_name, settings.video_seconds)
    sources = existing_files(args.fichiers) if args.fichiers else etapes.default_video_sources(project)
    if not sources:
        raise ConfigError("Aucune image à animer : lancez d'abord « storyboard » ou « rendus ».")
    print(f"Modèle vidéo : {settings.video_name} ({settings.video.endpoint})")
    code = run_jobs(settings, etapes.video_jobs(project, settings, sources, args.mouvement), args)
    if args.apply and code == 0:
        print(f"Vidéos dans {project.output / 'videos'} : il reste à les monter (Clipchamp, CapCut, Premiere...).")
    return code


def warn_references(project: Project) -> None:
    count = len(project.references())
    if count > MAX_REFERENCES:
        print(f"Attention : {count} références, seules les {MAX_REFERENCES} premières (ordre alphabétique) sont envoyées.")


COMMANDS = {"nouveau": cmd_nouveau, "essais": cmd_essais, "maitre": cmd_maitre, "rendus": cmd_rendus,
            "storyboard": cmd_storyboard, "upscale": cmd_upscale, "video": cmd_video}


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):  # accents lisibles dans la console Windows
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    try:
        return COMMANDS[args.command](Settings.from_env(), args)
    except (ConfigError, FatalError, ServiceError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Erreur de fichier : {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
