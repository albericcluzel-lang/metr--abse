"""Ligne de commande : python -m rendu_ia {nouveau,essais,maitre,rendus,storyboard,upscale,video,montage,etat}."""
from __future__ import annotations

import argparse
import dataclasses
import sys
from pathlib import Path

from . import etapes, montage, prompts
from .config import VIDEO_MODELS, ConfigError, FatalError, Settings, check_video_seconds
from .etapes import Job
from .gemini import GeminiProvider
from .projet import Project
from .service import FalProvider, Provider, ServiceError

# Textes de l'aide et des erreurs de la ligne de commande : argparse les fournit en anglais.
ARGPARSE_FR = {
    "usage: ": "utilisation : ",
    "positional arguments": "arguments",
    "options": "options",
    "subcommands": "commandes",
    "show this help message and exit": "afficher cette aide et quitter",
    " (default: %(default)s)": " (par défaut : %(default)s)",
    "%(prog)s: error: %(message)s\n": "%(prog)s : erreur : %(message)s\n",
    "argument %(argument_name)s: %(message)s": "%(argument_name)s : %(message)s",
    "the following arguments are required: %s": "arguments obligatoires manquants : %s",
    "unrecognized arguments: %s": "arguments inconnus : %s",
    "invalid choice: %(value)r (choose from %(choices)s)": "choix impossible : %(value)r (possibles : %(choices)s)",
    "invalid %(type)s value: %(value)r": "valeur invalide : %(value)r",
    "expected one argument": "une valeur est attendue après cette option",
    "ambiguous option: %(option)s could match %(matches)s": "option ambiguë : %(option)s peut désigner %(matches)s",
}
argparse._ = lambda text: ARGPARSE_FR.get(text, text)


def bounded_int(low: int, high: int):
    def parse(value: str) -> int:
        number = int(value)
        if not low <= number <= high:
            raise argparse.ArgumentTypeError(f"doit être un entier entre {low} et {high}")
        return number
    return parse


def bounded_float(low: float, high: float):
    def parse(value: str) -> float:
        try:
            number = float(value.replace(",", "."))
        except ValueError:
            raise argparse.ArgumentTypeError(f"doit être un nombre entre {low:g} et {high:g}") from None
        if not low <= number <= high:
            raise argparse.ArgumentTypeError(f"doit être un nombre entre {low:g} et {high:g}")
        return number
    return parse


def with_help(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument("-h", "--aide", action="help", help="afficher cette aide et quitter")
    return parser


def build_parser() -> argparse.ArgumentParser:
    parser = with_help(argparse.ArgumentParser(
        prog="rendu_ia", add_help=False, description="Rendus photo et vidéo à partir de captures Archicad."))
    commands = parser.add_subparsers(dest="command", required=True, metavar="commande")

    def command(name: str, help: str) -> argparse.ArgumentParser:
        return with_help(commands.add_parser(name, help=help, description=help, add_help=False))

    nouveau = command("nouveau", "créer un dossier de projet (captures, références, ambiance)")
    nouveau.add_argument("projet", help="dossier du projet à créer")
    nouveau.add_argument("--depuis", help="dossier dont copier les images dans « captures » (par exemple vos exports "
                         "Archicad)")

    def paid(name: str, help: str) -> argparse.ArgumentParser:
        sub = command(name, help)
        sub.add_argument("projet", help="dossier du projet")
        sub.add_argument("--apply", action="store_true",
                         help="lancer réellement ; sans cette option, simple simulation qui n'envoie rien")
        sub.add_argument("--refaire", action="store_true", help="refaire aussi ce qui existe déjà")
        return sub

    essais = paid("essais", "plusieurs propositions d'une vue, pour valider la direction (simulation par défaut)")
    essais.add_argument("--capture", help="vue à essayer (nom du fichier dans « captures »)")
    essais.add_argument("--nombre", type=bounded_int(1, 4), default=2, help="nombre de propositions (2)")
    essais.add_argument("--personnages", action="store_true", help="ajouter une ou deux personnes")

    maitre = command("maitre", "verrouiller l'image maître qui donne le style aux autres")
    maitre.add_argument("projet", help="dossier du projet")
    maitre.add_argument("image", help="image choisie (en général une des propositions des essais)")

    rendus = paid("rendus", "toutes les vues, dans le style de l'image maître (simulation par défaut)")
    rendus.add_argument("--capture", action="append", help="seulement cette vue (option répétable)")
    rendus.add_argument("--variantes", type=bounded_int(1, 4), default=1, help="images par vue (1)")
    rendus.add_argument("--personnages", action="store_true", help="ajouter une ou deux personnes")

    storyboard = paid("storyboard", "plans cinématiques tirés d'une image (simulation par défaut)")
    storyboard.add_argument("--image", help="image de départ (par défaut l'image maître)")
    storyboard.add_argument("--plans", type=bounded_int(1, 8), default=4, help="nombre de plans (4)")
    storyboard.add_argument("--ambiance", choices=sorted(prompts.AMBIANCES), default=prompts.DEFAULT_AMBIANCE,
                            help="calme (contemplation, haut de gamme) ou dynamique (vent, énergie)")
    storyboard.add_argument("--sans-images", action="store_true",
                            help="écrire seulement les consignes : chaque plan reprend l'image de départ "
                                 "(aucune image générée, gratuit avec une clé gratuite)")

    upscale = paid("upscale", "agrandir les images (simulation par défaut)")
    upscale.add_argument("fichiers", nargs="*", help="images à agrandir (par défaut rendus et storyboard)")

    video = paid("video", "animer les images (simulation par défaut)")
    video.add_argument("fichiers", nargs="*", help="images à animer (par défaut les plans du storyboard)")
    video.add_argument("--duree", type=int, help="durée de chaque vidéo en secondes")
    video.add_argument("--modele", choices=sorted(VIDEO_MODELS), help="modèle vidéo (par défaut RENDU_MODELE_VIDEO)")
    video.add_argument("--mouvement", help="mouvement de caméra, par exemple « vol traversant en vue FPV, "
                       "extrêmement lent » (remplace celui du storyboard)")
    video.add_argument("--ambiance", choices=sorted(prompts.AMBIANCES),
                       help="calme ou dynamique (par défaut celle du storyboard, sinon calme)")
    video.add_argument("--essai", action="store_true",
                       help="essai à moindre coût avant la version finale : durée minimale, 480p avec Seedance, "
                            "rangé dans « videos/essais »")

    assemblage = command("montage", "mettre les vidéos bout à bout, avec un fondu entre chacune (gratuit, sur le PC)")
    assemblage.add_argument("projet", help="dossier du projet")
    assemblage.add_argument("fichiers", nargs="*", help="vidéos ou images dans l'ordre voulu (par défaut la vidéo de "
                            "chaque plan, ou son image tant que la vidéo manque)")
    assemblage.add_argument("--fondu", type=bounded_float(0, 2), default=0.5,
                            help="durée du fondu en secondes, 0 pour enchaîner sans fondu (0,5)")
    assemblage.add_argument("--duree-image", type=bounded_float(1, 15), default=4,
                            help="durée à l'écran d'une image fixe, animée d'un lent zoom (4 secondes)")
    assemblage.add_argument("--sortie", help="vidéo produite (par défaut sorties/montage.mp4)")

    etat = command("etat", "faire le point sur le projet et donner la prochaine commande (aucun appel)")
    etat.add_argument("projet", help="dossier du projet")
    return parser


def make_provider(settings: Settings) -> Provider:
    """Fournisseur des images, du storyboard et de l'upscale."""
    return GeminiProvider(settings) if settings.provider == "gemini" else FalProvider(settings)


def make_video_provider(settings: Settings) -> FalProvider:
    return FalProvider(settings)


def provider_label(settings: Settings, video: bool = False) -> str:
    if video:
        return f"fal.ai, {settings.video_name} ({settings.video.endpoint})"
    if settings.provider == "gemini":
        return f"Gemini ({settings.gemini_image_model})"
    return f"fal.ai ({settings.image_model})"


def run_jobs(settings: Settings, jobs: list[Job], args: argparse.Namespace, provider: Provider | None = None,
             extra: int = 0, video: bool = False) -> int:
    """Simulation (liste de ce qui serait payé) ou lancement réel avec --apply.

    `extra` : demandes annoncées en plus des travaux (storyboard à écrire).
    `video` : travaux à confier au fournisseur des vidéos (fal.ai).
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
        print(f"Simulation : {len(todo) + extra} demande(s) seraient envoyée(s) à "
              f"{provider_label(settings, video)}. Ajoutez --apply pour lancer.")
        return 0
    own = provider is None
    if own:
        provider = make_video_provider(settings) if video else make_provider(settings)
    try:
        report = etapes.execute(todo, provider, settings.parallel, lambda line: print(line, flush=True))
    finally:
        if own:
            provider.close()
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
          "  ambiance.txt  l'ambiance voulue, en quelques lignes (facultatif)")
    if args.depuis:
        imported, ignored = project.import_captures(args.depuis)
        print(f"{len(imported)} capture(s) copiée(s) depuis {args.depuis} : "
              f"{', '.join(path.name for path in imported) or 'aucune'}")
        if ignored:
            print(f"Ignoré(s), format non pris en charge : {', '.join(ignored)}")
    print(f"Ensuite : python -m rendu_ia essais \"{project.root}\"")
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
    warn_references(project, settings, master=False)
    jobs = etapes.essais_jobs(project, capture, args.nombre, args.personnages, settings.image_limits[0])
    after = f"python -m rendu_ia maitre \"{project.root}\" <image choisie>"
    if not settings.has_key:
        return manual_images(project, jobs, args, "essais", "choisir la meilleure proposition, puis " + after)
    code = run_jobs(settings, jobs, args)
    if args.apply and code == 0:
        print(f"Choisissez la meilleure proposition dans {project.output / 'essais'}, puis :\n  {after}")
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
    warn_references(project, settings, master=project.master() is not None)
    jobs = etapes.rendus_jobs(project, captures, args.variantes, args.personnages, settings.image_limits[0])
    if not settings.has_key:
        return manual_images(project, jobs, args, "rendus", f"python -m rendu_ia video \"{project.root}\" "
                             "(une vidéo par rendu), ou storyboard pour plusieurs plans tirés d'une image")
    code = run_jobs(settings, jobs, args)
    if args.apply and code == 0:
        print(f"Ensuite : python -m rendu_ia storyboard \"{project.root}\"")
    return code


def manual_images(project: Project, jobs: list[Job], args: argparse.Namespace, folder: str, after: str) -> int:
    """Sans clé API : fiche pour faire les images à la main dans l'application Gemini (aucun appel)."""
    todo = etapes.pending(jobs, args.refaire)
    if not todo:
        print(f"Toutes les images sont déjà dans {project.output / folder} (--refaire pour refaire la fiche).\n"
              f"Ensuite : {after}")
        return 0
    sheet = etapes.write_gemini_sheet(project, todo, folder, after)
    print(f"Pas de clé API : les images se font à la main dans Gemini, avec l'abonnement Google AI Pro.\n"
          f"Fiche à suivre, avec les images à joindre et le texte de chacune des {len(todo)} vue(s) : {sheet}")
    return 0


def cmd_storyboard(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.open(args.projet)
    image = Path(args.image) if args.image else project.master()
    if image is None:
        raise ConfigError("Pas d'image maître : verrouillez-en une (commande « maitre ») ou donnez --image.")
    if not image.is_file():
        raise ConfigError(f"Image introuvable : {image}")
    count = args.plans
    if settings.text_model is None and count > len(prompts.DEFAULT_SHOTS):
        count = len(prompts.DEFAULT_SHOTS)
        print(f"Sans modèle de texte, {count} plans types au plus.")
    folder = etapes.storyboard_folder(project, image)
    shots = None if args.refaire else etapes.load_storyboard(folder, image)
    if shots is not None:
        print(f"Storyboard existant réutilisé ({len(shots)} plans) : {folder / 'storyboard.json'}")
    elif not args.refaire and (folder / "storyboard.json").is_file():
        print("L'image de départ a changé depuis le storyboard : il sera réécrit et ses plans refaits.")

    if args.sans_images:
        return storyboard_without_images(settings, args, project, image, folder, shots, count)
    if shots is not None:
        code = run_jobs(settings, etapes.shot_jobs(image, folder, shots), args)
    elif not args.apply:
        writer = settings.text_model or "plans types, sans modèle de texte"
        print(f"[à faire] écrire le storyboard de {count} plans ({writer})")
        placeholders = [prompts.Shot("plan à écrire", "", "") for _ in range(count)]
        code = run_jobs(settings, etapes.shot_jobs(image, folder, placeholders), args,
                        extra=1 if settings.text_model else 0)
    else:
        provider = make_provider(settings)
        try:
            print("Écriture du storyboard...", flush=True)
            shots = etapes.write_storyboard(provider, settings, image, count, args.ambiance)
            etapes.save_storyboard(folder, image, shots, args.ambiance)
            for index, shot in enumerate(shots, start=1):
                print(f"  plan {index} : {shot.title}\n      image : {shot.image}\n      mouvement : {shot.motion}")
            code = run_jobs(settings, etapes.shot_jobs(image, folder, shots), args, provider)
        finally:
            provider.close()
    if args.apply and code == 0:
        print(f"Plans dans {folder}. Ensuite : python -m rendu_ia upscale \"{project.root}\"")
    return code


def storyboard_without_images(settings: Settings, args: argparse.Namespace, project: Project, image: Path,
                               folder: Path, shots: list[prompts.Shot] | None, count: int) -> int:
    """Consignes seulement : les plans reprennent l'image de départ, seul le modèle de texte est appelé.
    Sans clé API, les plans types suffisent : ce parcours ne demande alors aucun compte."""
    use_model = settings.text_model is not None and settings.has_key
    if not use_model:
        count = min(count, len(prompts.DEFAULT_SHOTS))
    if not args.apply:
        if shots is None:
            writer = settings.text_model if use_model else "plans types, sans modèle de texte"
            print(f"[à faire] écrire le storyboard de {count} plans ({writer})")
        print("Les plans reprendront l'image de départ : aucune image ne sera générée.")
        if shots is None and use_model:
            print("Simulation : 1 demande serait envoyée au modèle de texte. Ajoutez --apply pour lancer.")
        return 0
    if shots is None:
        if settings.text_model and not use_model:
            print("Pas de clé API : plans types, sans modèle de texte.")
        provider = make_provider(settings) if use_model else None
        try:
            print("Écriture du storyboard...", flush=True)
            shots = etapes.write_storyboard(provider, settings, image, count, args.ambiance, same_image=True)
        finally:
            if provider:
                provider.close()
        etapes.save_storyboard(folder, image, shots, args.ambiance)
        for index, shot in enumerate(shots, start=1):
            print(f"  plan {index} : {shot.title}\n      mouvement : {shot.motion}")
    etapes.copy_plans(image, folder, len(shots))
    print(f"Plans prêts dans {folder} (copies de l'image de départ).\n"
          f"Ensuite : python -m rendu_ia video \"{project.root}\"")
    return 0


def cmd_upscale(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.open(args.projet)
    sources = existing_files(args.fichiers) if args.fichiers else etapes.default_upscale_sources(project)
    if not sources:
        raise ConfigError("Aucune image à agrandir : lancez d'abord « rendus » ou « storyboard ».")
    if settings.provider == "gemini":
        if settings.image_limits[1] != "4K":
            raise ConfigError(f"Le modèle {settings.gemini_image_model} ne sort pas en 4K : il ne peut pas "
                              "agrandir les images. Utilisez un logiciel d'agrandissement gratuit sur votre PC "
                              "(voir le README), ou un modèle payant (RENDU_GEMINI_MODELE_IMAGE).")
        print("Avec Gemini, l'upscale régénère chaque image en 4K : vérifiez qu'aucun détail n'a changé.")
    code = run_jobs(settings, etapes.upscale_jobs(project, sources), args)
    if args.apply and code == 0:
        print(f"Ensuite : python -m rendu_ia video \"{project.root}\"")
    return code


def cmd_video(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.open(args.projet)
    if args.modele:
        settings = dataclasses.replace(settings, video_name=args.modele, video=VIDEO_MODELS[args.modele])
    if args.duree is not None:
        settings = dataclasses.replace(settings, video_seconds=args.duree)
    folder = "videos"
    if args.essai:
        # Comme le créateur de la seconde vidéo : on teste le mouvement au plus bas prix, puis on refait en HD.
        low = {"resolution": "480p"} if settings.video_name == "seedance" else {}
        settings = dataclasses.replace(settings, video_seconds=settings.video.min_seconds,
                                       video_options={**low, **settings.video_options})
        folder = "videos/essais"
    check_video_seconds(settings.video, settings.video_name, settings.video_seconds)
    sources = existing_files(args.fichiers) if args.fichiers else etapes.default_video_sources(project)
    if not sources:
        raise ConfigError("Aucune image à animer : lancez d'abord « storyboard » ou « rendus ».")
    jobs = etapes.video_jobs(project, settings, sources, args.mouvement, args.ambiance, folder)
    if not settings.fal_key:
        if args.essai:
            print("Dans Flow, l'essai se fait avec Veo 3.1 Lite, le modèle le moins cher (voir la fiche).")
        jobs = etapes.video_jobs(project, settings, sources, args.mouvement, args.ambiance)
        todo = etapes.pending(jobs, args.refaire)
        if not todo:
            print(f"Toutes les vidéos sont déjà dans {project.output / 'videos'} (--refaire pour refaire la fiche).")
            return 0
        sheet = etapes.write_flow_sheet(project, [job.sources[0] for job in todo], args.mouvement, args.ambiance)
        print(f"Pas de clé fal.ai : les vidéos se font dans Flow, payées par les crédits de l'abonnement "
              f"Google AI Pro.\nFiche à suivre, avec l'image et le texte de chacun des {len(todo)} plan(s) : {sheet}")
        return 0
    code = run_jobs(settings, jobs, args, video=True)
    if args.apply and code == 0:
        print(f"Vidéos dans {project.output / 'videos'}. Ensuite : python -m rendu_ia montage \"{project.root}\"")
    return code


def cmd_montage(settings: Settings, args: argparse.Namespace) -> int:
    project = Project.open(args.projet)
    clips = existing_files(args.fichiers) if args.fichiers else etapes.default_montage_clips(project)
    if not clips:
        raise ConfigError("Rien à monter : lancez d'abord « rendus » puis « video » (ou rangez dans "
                          f"{project.output / 'videos'} les vidéos faites dans Flow).")
    target = Path(args.sortie) if args.sortie else project.output / "montage.mp4"
    print("Ordre du montage :")
    for index, clip in enumerate(clips, start=1):
        kind = "image, lent zoom" if clip.suffix.lower() in etapes.IMAGE_SUFFIXES else "vidéo"
        print(f"  {index}. {clip} ({kind})")
    print("Montage en cours...", flush=True)
    read, seconds = montage.assemble(clips, target, args.fondu, args.duree_image)
    width, height = montage.output_size(read)
    print(f"Montage prêt : {target} ({seconds:.1f} s, {width}x{height}, sans le son).\n"
          "Pour un autre ordre, donnez les vidéos une à une dans l'ordre voulu. La musique s'ajoute ensuite "
          "dans Clipchamp ou CapCut.")
    return 0


def cmd_etat(settings: Settings, args: argparse.Namespace) -> int:
    """Le point sur le projet, sans aucun appel : ce qui est fait, ce qui manque, la prochaine commande."""
    project = Project.open(args.projet)
    out = project.output
    root = f"\"{project.root}\""
    captures = project.captures()
    master = project.master()
    rendus = etapes.rendus_jobs(project, captures, 1, False, settings.image_limits[0])
    rendus_todo = etapes.pending(rendus, False)
    storyboards = sorted(path.parent for path in (out / "storyboard").glob("*/storyboard.json"))
    videos = etapes.video_jobs(project, settings, etapes.default_video_sources(project), None)
    videos_todo = etapes.pending(videos, False)
    videos_done = len(videos) - len(videos_todo)
    clips = etapes.default_montage_clips(project)
    montage_file = out / "montage.mp4"
    montage_done = bool(clips) and montage_file.is_file() and montage_file.stat().st_mtime >= max(
        clip.stat().st_mtime for clip in clips)
    essais = [path for path in (out / "essais").glob("*") if path.suffix.lower() in etapes.IMAGE_SUFFIXES]
    upscaled = [path for path in (out / "upscale").rglob("*") if path.suffix.lower() in etapes.IMAGE_SUFFIXES]

    key = "oui" if settings.has_key else "non (parcours gratuit sans clé possible)"
    print(f"Projet : {project.root}\nFournisseur : {provider_label(settings)}, clé : {key}")
    print(f"Captures : {len(captures)} ; références : {len(project.references())} ; essais : {len(essais)}")
    print(f"Image maître : {master.relative_to(project.root) if master else 'aucune'}")
    print(f"Rendus à jour : {len(rendus) - len(rendus_todo)}/{len(rendus)}"
          + (f" (à faire : {', '.join(job.label.removeprefix('rendu ') for job in rendus_todo)})" if rendus_todo else ""))
    for folder in storyboards:
        plans = [path for path in folder.glob("plan_*") if path.suffix.lower() in etapes.IMAGE_SUFFIXES]
        print(f"Storyboard « {folder.name} » : {len(plans)} plan(s)")
    print(f"Images agrandies : {len(upscaled)} ; vidéos à jour : {videos_done}/{len(videos)} ; "
          f"montage : {'à jour' if montage_done else 'à faire'}")

    if not captures and not storyboards:
        step = (f"déposez vos captures Archicad dans « captures », ou partez d'une image existante : "
                f"python -m rendu_ia storyboard {root} --image <image> --sans-images --apply")
    elif captures and master is None:
        step = f"python -m rendu_ia essais {root} --capture {captures[0].stem}"
    elif rendus_todo:
        step = f"python -m rendu_ia rendus {root}"
    elif not storyboards and not videos_done:
        step = (f"python -m rendu_ia video {root} (une vidéo par rendu), ou python -m rendu_ia storyboard {root} "
                "pour plusieurs plans tirés d'une image")
    elif videos_todo:
        step = f"python -m rendu_ia video {root}"
    elif not montage_done:
        step = f"python -m rendu_ia montage {root}"
    else:
        step = f"tout est à jour, montage : {out / 'montage.mp4'}"
    print(f"Prochaine étape : {step}")
    return 0


def warn_references(project: Project, settings: Settings, master: bool) -> None:
    references = project.references()
    room = etapes.reference_room(settings.image_limits[0], master)
    if len(references) > room:
        kept = ", ".join(path.name for path in references[:room]) or "aucune"
        alongside = "la capture et l'image maître" if master else "la capture"
        print(f"Attention : {len(references)} références, mais ce modèle n'en accepte que {room} avec "
              f"{alongside}. Envoyées (ordre alphabétique) : {kept}.")


COMMANDS = {"nouveau": cmd_nouveau, "essais": cmd_essais, "maitre": cmd_maitre, "rendus": cmd_rendus,
            "storyboard": cmd_storyboard, "upscale": cmd_upscale, "video": cmd_video, "montage": cmd_montage,
            "etat": cmd_etat}


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
