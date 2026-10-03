"""Ligne de commande : python -m outlook_agent {login,setup,run,undo}."""
from __future__ import annotations

import argparse
import dataclasses
import os
import sys

import requests

from .agent import Agent, Outcome, RunLock, render_digest, save_digest, setup_mailbox
from .auth import TokenProvider
from .classifier import classify
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


def _openai_client():
    if not os.environ.get("OPENAI_API_KEY"):
        raise ConfigError("OPENAI_API_KEY manquante : voir le README, étape 1.")
    from openai import OpenAI

    return OpenAI()


def _mailbox(settings: Settings) -> GraphClient:
    return GraphClient(TokenProvider(settings).token)


def describe(outcome: Outcome) -> str:
    if outcome.error:
        return f"[ERREUR] {outcome.mail.subject} : {outcome.error}"
    decision = outcome.decision
    tags = ("[URGENT] " if decision.urgent else "") + ("[ACTION] " if decision.action_required else "")
    where = decision.folder or "reste en boîte de réception"
    return f"{tags}{outcome.mail.subject} ({outcome.mail.sender or outcome.mail.address}) -> {where}"


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
    client = _openai_client()
    # Verrou pris avant de lire l'état : un passage qui se termine ne peut pas l'écrire entre-temps.
    with RunLock(settings.home):
        agent = Agent(
            _mailbox(settings),
            lambda mail: classify(client, settings.model, mail, CATEGORIES, settings.user_context),
            settings,
            CATEGORIES,
        )
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


COMMANDS = {"login": cmd_login, "setup": cmd_setup, "run": cmd_run, "undo": cmd_undo}


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
