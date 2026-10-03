"""Ligne de commande : python -m outlook_agent {test-ia,login,setup,run,undo}."""
from __future__ import annotations

import argparse
import dataclasses
import os
import sys
import time

import requests

from .agent import Agent, Mail, Outcome, RunLock, render_digest, save_digest, setup_mailbox
from .auth import TokenProvider
from .classifier import Classifier
from .config import CATEGORIES, ConfigError, FatalError, Settings
from .graph import GraphClient, GraphError


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("doit être un entier supérieur ou égal à 1")
    return number


def confidence(value: str) -> float:
    number = float(value.replace(",", "."))
    if not 0.0 <= number <= 1.0:
        raise argparse.ArgumentTypeError("doit être entre 0 et 1 (par exemple 0.6)")
    return number


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="outlook_agent", description="Agent de tri de la boîte Outlook.")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("test-ia", help="vérifier le fournisseur d'IA avec un mail fictif (sans Outlook)")
    commands.add_parser("login", help="se connecter à Microsoft 365 (une seule fois)")
    commands.add_parser("setup", help="créer les dossiers et catégories dans Outlook")

    run = commands.add_parser("run", help="trier la boîte de réception (simulation par défaut)")
    run.add_argument("--apply", action="store_true", help="appliquer réellement le tri")
    run.add_argument("--limit", type=positive_int, default=50, help="nombre maximum de mails à analyser (50)")
    run.add_argument("--since-days", type=positive_int, help="ne regarder que les mails des N derniers jours")
    run.add_argument("--min-confidence", type=confidence, help="seuil de confiance, de 0 à 1")
    run.add_argument("--reprocess", action="store_true", help="ré-analyser aussi les mails déjà traités")

    undo = commands.add_parser("undo", help="annuler un passage (simulation par défaut)")
    undo.add_argument("--apply", action="store_true", help="annuler réellement")
    undo.add_argument("--run-id", help="passage à annuler (par défaut le dernier)")
    return parser


def _openai_client(settings: Settings):
    """Client du fournisseur d'IA : OpenAI par défaut, ou tout service compatible (OPENAI_BASE_URL)."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key and settings.llm_is_local:
        key = "local"  # un modèle local (Ollama, LM Studio) n'a pas besoin de vraie clé
    if not key:
        raise ConfigError("OPENAI_API_KEY manquante : clé du fournisseur d'IA, voir le README, étape 1.")
    import openai

    extra = {}
    if settings.llm_is_local:
        # Jamais de proxy vers un modèle local : sinon le contenu des mails partirait vers le proxy
        # de l'entreprise (variables HTTP_PROXY ou proxy système de Windows).
        extra["http_client"] = openai.DefaultHttpxClient(trust_env=False)
    return openai.OpenAI(api_key=key, base_url=settings.llm_base_url, max_retries=settings.llm_max_retries, **extra)


def _request_options(settings: Settings) -> dict:
    """Paramètres du modèle définis dans .env (rien n'est envoyé pour ceux laissés vides)."""
    options = {"temperature": settings.llm_temperature, "max_tokens": settings.llm_max_tokens,
               "reasoning_effort": settings.llm_reasoning_effort}
    return {name: value for name, value in options.items() if value is not None}


def _mailbox(settings: Settings) -> GraphClient:
    return GraphClient(TokenProvider(settings).token)


def describe(outcome: Outcome) -> str:
    if outcome.error:
        return f"[ERREUR] {outcome.mail.subject} : {outcome.error}"
    decision = outcome.decision
    tags = ("[URGENT] " if decision.urgent else "") + ("[ACTION] " if decision.action_required else "")
    where = decision.folder or "reste en boîte de réception"
    return f"{tags}{outcome.mail.subject} ({outcome.mail.sender or outcome.mail.address}) -> {where}"


# Mail inventé : le test ne lit ni n'envoie aucun vrai mail.
SAMPLE_MAIL = Mail(
    id="test", subject="Facture n°2026-118 - lot plâtrerie, chantier résidence Les Arceaux",
    sender="Service comptabilité (exemple)", address="compta@exemple.fr", received="",
    body="Bonjour, veuillez trouver ci-joint notre facture n°2026-118 pour la situation n°3 du lot "
         "plâtrerie. Échéance de paiement au 15 du mois prochain. Merci de nous confirmer sa bonne "
         "réception et la date de règlement prévue. Cordialement.",
    has_attachments=True, importance="normal",
)


def cmd_test_ia(settings: Settings, args: argparse.Namespace) -> int:
    """Vérifie clé, modèle et format de réponse du fournisseur d'IA, sans toucher à Outlook."""
    classifier = Classifier(_openai_client(settings), settings.model, CATEGORIES, settings.user_context,
                            json_mode=settings.json_mode, options=_request_options(settings))
    print(f"Fournisseur : {settings.llm_base_url}\nModèle : {settings.model}\nTest avec un mail fictif...", flush=True)
    started = time.monotonic()
    try:
        verdict = classifier(SAMPLE_MAIL)
    except FatalError:
        raise
    except Exception as exc:  # modèle qui répond mal : message clair plutôt qu'une trace Python
        print(f"Erreur : le fournisseur d'IA a mal répondu : {exc}", file=sys.stderr)
        return 1
    if verdict is None:
        print("Erreur : le modèle a refusé de répondre.", file=sys.stderr)
        return 1
    print(f"Réponse en {time.monotonic() - started:.1f} s (format « {classifier.mode} ») : "
          f"catégorie « {verdict.category} », urgent : {'oui' if verdict.urgent else 'non'}, "
          f"action requise : {'oui' if verdict.action_required else 'non'}, confiance : {verdict.confidence:.2f}")
    print(f"Résumé : {verdict.summary}")
    print("Le fournisseur d'IA fonctionne. Aucun de vos mails n'a été envoyé : ce test utilise un mail inventé.")
    return 0


def cmd_login(settings: Settings, args: argparse.Namespace) -> int:
    TokenProvider(settings).token(interactive=True)
    print("Connexion réussie.")
    return 0


def cmd_setup(settings: Settings, args: argparse.Namespace) -> int:
    for line in setup_mailbox(_mailbox(settings), CATEGORIES):
        print(line)
    return 0


def cmd_run(settings: Settings, args: argparse.Namespace) -> int:
    if args.min_confidence is not None:
        settings = dataclasses.replace(settings, min_confidence=args.min_confidence)
    classifier = Classifier(_openai_client(settings), settings.model, CATEGORIES, settings.user_context,
                            json_mode=settings.json_mode, pause=settings.llm_pause,
                            options=_request_options(settings))
    # Verrou pris avant de lire l'état : un passage qui se termine ne peut pas l'écrire entre-temps.
    with RunLock(settings.home):
        agent = Agent(_mailbox(settings), classifier, settings, CATEGORIES)
        warn_if_state_recovered(agent)
        report = agent.run(apply=args.apply, limit=args.limit, since_days=args.since_days,
                           reprocess=args.reprocess)

    for outcome in report.outcomes:
        print(describe(outcome))
    digest = render_digest(report)
    saved = save_digest(settings.home, report, digest)
    print()
    print(digest)
    if saved:
        print(f"Résumé enregistré dans {saved}")
    if not args.apply:
        print("Simulation : rien n'a été modifié. Ajoutez --apply pour appliquer le tri.")
    if args.apply and report.outcomes:
        print(f"Passage {report.run_id} (pour l'annuler : python -m outlook_agent undo --run-id {report.run_id})")
    if settings.json_mode == "auto" and classifier.mode != "schema":
        print(f"Note : ce fournisseur d'IA n'accepte pas les réponses à schéma strict, l'agent est passé "
              f"au mode « {classifier.mode} ». Pour l'utiliser d'emblée : OUTLOOK_JSON_MODE={classifier.mode} dans .env.")
    if report.aborted:
        print(f"Erreur : passage interrompu avant la fin : {report.aborted}", file=sys.stderr)
    return 1 if report.errors or report.aborted else 0


def warn_if_state_recovered(agent: Agent) -> None:
    if agent.state.recovered_from:
        print(f"Attention : l'état de l'agent était illisible, il a été mis de côté dans "
              f"{agent.state.recovered_from}. Des mails restés en boîte de réception peuvent être "
              "ré-analysés.", file=sys.stderr)


def cmd_undo(settings: Settings, args: argparse.Namespace) -> int:
    with RunLock(settings.home):
        agent = Agent(_mailbox(settings), lambda mail: None, settings, CATEGORIES)
        warn_if_state_recovered(agent)
        items = agent.undo(apply=args.apply, run_id=args.run_id)
    if not items:
        print("Rien à annuler." if not args.run_id else f"Rien à annuler : passage {args.run_id} inconnu ou déjà annulé.")
        return 0
    for item in items:
        status = "remis" if item.restored else (f"NON ANNULÉ : {item.error}" if item.error else "à remettre")
        print(f"[{status}] {item.entry.get('subject', '(sans objet)')} "
              f"(était rangé dans : {item.entry['moved_to'] or 'boîte de réception'})"
              + (f" : {item.note}" if item.note else ""))
    if not args.apply:
        print("Simulation : rien n'a été modifié. Ajoutez --apply pour annuler réellement.")
    return 1 if any(item.error for item in items) else 0


COMMANDS = {"test-ia": cmd_test_ia, "login": cmd_login, "setup": cmd_setup, "run": cmd_run, "undo": cmd_undo}


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):  # accents lisibles dans la console Windows
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    try:
        return COMMANDS[args.command](Settings.from_env(), args)
    except (ConfigError, FatalError, GraphError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        return 1
    except requests.RequestException as exc:  # avant OSError, dont elle hérite
        print(f"Erreur réseau (connexion à Microsoft impossible) : {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Erreur de fichier : {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
