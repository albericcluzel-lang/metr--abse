"""Logique de l'agent : décider où ranger chaque mail, l'appliquer, annuler, résumer."""
from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterator, Protocol

from .classifier import Verdict
from .config import (
    ACTION_LABEL, EXTRA_LABELS, REVIEW_LABEL, URGENT_FOLDER, URGENT_LABEL, Category, Settings,
)


class Mailbox(Protocol):
    """Ce dont l'agent a besoin de la boîte mail (implémenté par GraphClient)."""

    def iter_inbox_messages(self, since_days: int | None = None) -> Iterator[dict]: ...
    def get_body(self, message_id: str) -> str: ...
    def get_message(self, message_id: str) -> dict: ...
    def update_message(self, message_id: str, categories: list[str] | None = None,
                       flag_status: str | None = None) -> None: ...
    def move_message(self, message_id: str, destination: str) -> None: ...
    def child_folders(self) -> dict[str, str]: ...
    def create_folder(self, name: str) -> str: ...
    def master_categories(self) -> set[str]: ...
    def create_master_category(self, name: str, color: str) -> None: ...


def is_meeting_message(raw: dict) -> bool:
    """Invitations et réponses de réunion : on les laisse là où Outlook les attend."""
    return "eventMessage" in (raw.get("@odata.type") or "")


@dataclass(frozen=True)
class Mail:
    id: str
    subject: str
    sender: str
    address: str
    received: str
    body: str
    has_attachments: bool
    importance: str
    categories: list[str]
    flag_status: str

    @classmethod
    def from_graph(cls, raw: dict, body: str, body_chars: int) -> "Mail":
        address = (raw.get("from") or {}).get("emailAddress") or {}
        return cls(
            id=raw["id"],
            subject=raw.get("subject") or "(sans objet)",
            sender=address.get("name") or "",
            address=address.get("address") or "",
            received=raw.get("receivedDateTime") or "",
            body=re.sub(r"\s+", " ", body).strip()[:body_chars],
            has_attachments=bool(raw.get("hasAttachments")),
            importance=raw.get("importance") or "normal",
            categories=list(raw.get("categories") or []),
            flag_status=(raw.get("flag") or {}).get("flagStatus") or "notFlagged",
        )


@dataclass(frozen=True)
class Decision:
    category: Category | None
    folder: str | None          # None : le mail reste dans la boîte de réception
    labels: tuple[str, ...]
    flag: bool
    urgent: bool
    action_required: bool
    confidence: float
    summary: str
    note: str = ""


def decide(verdict: Verdict | None, categories: tuple[Category, ...], min_confidence: float) -> Decision:
    by_key = {category.key: category for category in categories}
    # Une confiance hors de 0..1 (ex. 45 « pour cent ») ou NaN n'est pas fiable : on ne range pas.
    if (verdict is None or verdict.category not in by_key
            or not math.isfinite(verdict.confidence) or not 0.0 <= verdict.confidence <= 1.0):
        return Decision(None, None, (REVIEW_LABEL,), False, False, False, 0.0, "",
                        "classement impossible, laissé en boîte de réception")

    category = by_key[verdict.category]
    common = dict(urgent=verdict.urgent, action_required=verdict.action_required,
                  confidence=verdict.confidence, summary=verdict.summary)

    if verdict.confidence < min_confidence:
        # Dans le doute on ne range pas, mais on garde le signal d'urgence visible.
        labels = (REVIEW_LABEL, URGENT_LABEL) if verdict.urgent else (REVIEW_LABEL,)
        return Decision(category, None, labels, verdict.urgent, note="confiance insuffisante, laissé en boîte de réception", **common)

    labels = [category.label]
    if verdict.urgent:
        labels.append(URGENT_LABEL)
    if verdict.action_required:
        labels.append(ACTION_LABEL)
    folder = URGENT_FOLDER if verdict.urgent else category.folder
    return Decision(category, folder, tuple(labels), verdict.urgent, **common)


def ensure_folder(mailbox: Mailbox, folders: dict[str, str], name: str) -> tuple[str, bool]:
    """Identifiant du sous-dossier `name`, créé s'il manque. Renvoie (id, créé ?)."""
    key = name.casefold()
    if key in folders:
        return folders[key], False
    folders[key] = mailbox.create_folder(name)
    return folders[key], True


@dataclass
class Outcome:
    mail: Mail
    decision: Decision | None
    applied: bool = False
    error: str | None = None


@dataclass
class RunReport:
    run_id: str
    apply: bool
    outcomes: list[Outcome] = field(default_factory=list)
    skipped_seen: int = 0
    skipped_events: int = 0

    @property
    def errors(self) -> list[Outcome]:
        return [outcome for outcome in self.outcomes if outcome.error]


def _write_atomic(path: Path, text: str) -> None:
    """Écrit d'abord un fichier temporaire : un arrêt brutal ne laisse jamais un fichier à moitié écrit."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, path)


class StateStore:
    """Mails déjà traités, et les catégories que l'agent leur a posées.

    Un mail laissé dans la boîte de réception n'est pas ré-analysé. Retenir les catégories posées
    par l'agent permet de ne jamais retirer une catégorie de l'utilisateur, même de même nom.
    """

    MAX_ENTRIES = 5000

    def __init__(self, path: Path):
        self._path = path
        self._seen: dict[str, dict] = {}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                data = {}
            processed = data.get("processed") if isinstance(data, dict) else None
            if isinstance(processed, dict):
                self._seen = {
                    mail_id: entry if isinstance(entry, dict) else {"time": str(entry), "labels": []}
                    for mail_id, entry in processed.items()
                }

    def seen(self, mail_id: str) -> bool:
        return mail_id in self._seen

    def agent_labels(self, mail_id: str) -> list[str]:
        labels = self._seen.get(mail_id, {}).get("labels")
        return list(labels) if isinstance(labels, list) else []

    def mark(self, mail_id: str, labels: list[str]) -> None:
        self._seen[mail_id] = {"time": datetime.now().isoformat(timespec="seconds"), "labels": labels}

    def save(self) -> None:
        recent = sorted(self._seen.items(), key=lambda item: str(item[1].get("time", "")))
        _write_atomic(self._path, json.dumps({"processed": dict(recent[-self.MAX_ENTRIES:])}, ensure_ascii=False))


class ActionLog:
    """Journal de ce qui a été modifié, pour pouvoir annuler un passage."""

    REQUIRED_KEYS = {"run_id", "id", "added_labels", "removed_labels", "flag_set", "moved_to"}

    def __init__(self, path: Path):
        self._path = path

    def append(self, entry: dict) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def mark_undone(self, run_id: str) -> None:
        self.append({"undone": run_id, "time": datetime.now().isoformat(timespec="seconds")})

    def _lines(self) -> Iterator[dict]:
        """Lignes valides du journal ; une ligne tronquée (arrêt brutal) est ignorée."""
        if not self._path.exists():
            return
        for line in self._path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(entry, dict):
                yield entry

    def entries(self) -> list[dict]:
        return [entry for entry in self._lines() if self.REQUIRED_KEYS <= entry.keys()]

    def undone_runs(self) -> set[str]:
        return {entry["undone"] for entry in self._lines() if "undone" in entry}


@dataclass
class UndoItem:
    entry: dict
    restored: bool = False
    error: str | None = None


class Agent:
    def __init__(self, mailbox: Mailbox, classify: Callable[[Mail], Verdict | None],
                 settings: Settings, categories: tuple[Category, ...]):
        self.mailbox = mailbox
        self.classify = classify
        self.settings = settings
        self.categories = categories
        self.state = StateStore(settings.home / "state.json")
        self.log = ActionLog(settings.home / "actions.jsonl")

    def run(self, *, apply: bool, limit: int, since_days: int | None = None,
            reprocess: bool = False) -> RunReport:
        report = RunReport(run_id=datetime.now().strftime("%Y%m%d-%H%M%S"), apply=apply)
        folders = self.mailbox.child_folders()

        # Liste complète avant toute modification : déplacer des mails pendant la pagination
        # décalerait les pages suivantes. `limit` compte les mails à analyser, pas ceux ignorés,
        # pour que des mails déjà traités restés en boîte de réception ne bloquent pas les plus anciens.
        pending = []
        for raw in self.mailbox.iter_inbox_messages(since_days):
            if is_meeting_message(raw):
                report.skipped_events += 1
            elif not reprocess and self.state.seen(raw["id"]):
                report.skipped_seen += 1
            else:
                pending.append(raw)
                if len(pending) >= limit:
                    break

        try:
            for raw in pending:
                report.outcomes.append(self._process(raw, apply, folders, report.run_id))
        finally:
            if apply:
                self.state.save()
        return report

    def _process(self, raw: dict, apply: bool, folders: dict[str, str], run_id: str) -> Outcome:
        # Chaque étape est protégée : une erreur sur un mail ne doit pas arrêter les autres.
        try:
            mail = Mail.from_graph(raw, self.mailbox.get_body(raw["id"]), self.settings.body_chars)
        except Exception as exc:
            return Outcome(Mail.from_graph(raw, "", 0), None, error=f"lecture : {exc}")
        try:
            decision = decide(self.classify(mail), self.categories, self.settings.min_confidence)
        except Exception as exc:
            return Outcome(mail, None, error=f"classement : {exc}")

        outcome = Outcome(mail, decision)
        if apply:
            try:
                owned = self._apply(mail, decision, folders, run_id)
                outcome.applied = True
                self.state.mark(mail.id, owned)
            except Exception as exc:
                outcome.error = f"application : {exc}"
        return outcome

    def _apply(self, mail: Mail, decision: Decision, folders: dict[str, str], run_id: str) -> list[str]:
        """Pose catégories, drapeau et dossier. Renvoie les catégories que l'agent possède désormais."""
        # Un re-classement remplace les catégories posées auparavant par l'agent ; celles de
        # l'utilisateur restent, et une catégorie qu'il avait déjà n'est jamais considérée comme à l'agent.
        owned_before = self.state.agent_labels(mail.id)
        kept = [label for label in mail.categories if label not in owned_before]
        owned = [label for label in decision.labels if label not in kept]
        labels = kept + owned
        flag_status = "flagged" if decision.flag and mail.flag_status == "notFlagged" else None
        self.mailbox.update_message(mail.id, categories=labels, flag_status=flag_status)

        entry = {
            "run_id": run_id,
            "time": datetime.now().isoformat(timespec="seconds"),
            "id": mail.id,
            "subject": mail.subject[:100],
            "sender": mail.address,
            "added_labels": [label for label in labels if label not in mail.categories],
            "removed_labels": [label for label in mail.categories if label not in labels],
            "owned_before": owned_before,
            "flag_set": flag_status is not None,
            "moved_to": None,
        }
        try:
            if decision.folder:
                folder_id, _ = ensure_folder(self.mailbox, folders, decision.folder)
                self.mailbox.move_message(mail.id, folder_id)
                entry["moved_to"] = decision.folder
        finally:
            self.log.append(entry)
        return owned

    def undo(self, *, apply: bool, run_id: str | None = None) -> list[UndoItem]:
        """Remet les mails d'un passage dans la boîte de réception et retire ce que l'agent a posé.

        Seuls les changements de l'agent sont défaits : une catégorie ou un drapeau ajoutés
        ensuite par l'utilisateur sont conservés. Sans `run_id`, annule le dernier passage
        qui ne l'a pas déjà été.
        """
        entries = self.log.entries()
        if run_id is None:
            undone = self.log.undone_runs()
            remaining = [entry["run_id"] for entry in entries if entry["run_id"] not in undone]
            if not remaining:
                return []
            run_id = remaining[-1]
        items = [UndoItem(entry) for entry in entries if entry["run_id"] == run_id]
        if not apply or not items:
            return items

        for item in items:
            entry = item.entry
            try:
                current = self.mailbox.get_message(entry["id"])
                categories = [c for c in current.get("categories") or [] if c not in entry["added_labels"]]
                categories += [c for c in entry["removed_labels"] if c not in categories]
                current_flag = (current.get("flag") or {}).get("flagStatus")
                flag_status = "notFlagged" if entry["flag_set"] and current_flag == "flagged" else None
                self.mailbox.update_message(entry["id"], categories=categories, flag_status=flag_status)
                if entry["moved_to"]:
                    self.mailbox.move_message(entry["id"], "inbox")
                self.state.mark(entry["id"], list(entry.get("owned_before") or []))
                item.restored = True
            except Exception as exc:
                item.error = str(exc)

        self.state.save()
        # Un passage annulé en partie reste la cible par défaut, pour pouvoir relancer l'annulation.
        if all(item.restored for item in items):
            self.log.mark_undone(run_id)
        return items


def setup_mailbox(mailbox: Mailbox, categories: tuple[Category, ...]) -> list[str]:
    """Crée les dossiers et, si la permission le permet, les catégories de couleur."""
    messages = []
    folders = mailbox.child_folders()
    for name in [category.folder for category in categories] + [URGENT_FOLDER]:
        _, created = ensure_folder(mailbox, folders, name)
        messages.append(f"Dossier {'créé' if created else 'déjà présent'} : {name}")

    try:
        existing = mailbox.master_categories()
    except Exception as exc:
        messages.append(
            "Catégories de couleur non créées (permission MailboxSettings.ReadWrite absente ?) : "
            "les catégories fonctionneront quand même, sans couleur tant que vous ne leur en "
            f"donnez pas une dans Outlook. Détail : {exc}"
        )
        return messages

    wanted = {category.label: category.color for category in categories} | EXTRA_LABELS
    for label, color in wanted.items():
        if label.casefold() in existing:
            messages.append(f"Catégorie déjà présente : {label}")
            continue
        try:
            mailbox.create_master_category(label, color)
            messages.append(f"Catégorie créée : {label}")
        except Exception as exc:
            messages.append(f"Catégorie non créée : {label} ({exc})")
    return messages


def render_digest(report: RunReport) -> str:
    """Résumé en français de ce qui demande l'attention, au format Markdown."""
    mode = "simulation, rien n'a été modifié" if not report.apply else "tri appliqué"
    done = [o for o in report.outcomes if o.decision and not o.error]
    moved = [o for o in done if o.decision.folder]
    left = [o for o in done if not o.decision.folder]
    # Un mail urgent reste signalé comme tel même si son rangement a échoué.
    urgent = [o for o in report.outcomes if o.decision and o.decision.urgent]
    lines = [
        f"# Résumé du tri du {datetime.now():%d/%m/%Y à %H:%M} ({mode})",
        "",
        f"{len(report.outcomes)} mails analysés : {len(moved)} {'rangés' if report.apply else 'à ranger'}, "
        f"{len(left)} laissés en boîte de réception, {len(report.errors)} en erreur. "
        f"Ignorés : {report.skipped_seen} déjà traités, {report.skipped_events} invitations.",
    ]

    def section(title: str, selected: list[Outcome]) -> None:
        if not selected:
            return
        lines.extend(["", f"## {title}", ""])
        for o in selected:
            where = f"NON RANGÉ ({o.error})" if o.error else (o.decision.folder or "boîte de réception")
            lines.append(f"- **{o.mail.subject}** ({o.mail.sender or o.mail.address}) → {where}. "
                         f"{o.decision.summary}".rstrip())

    # Chaque mail n'apparaît que dans une seule section.
    section("Urgents", urgent)
    section("Actions à mener", [o for o in moved if o.decision.action_required and not o.decision.urgent])
    section("Laissés en boîte de réception, à vérifier", [o for o in left if not o.decision.urgent])

    counts: dict[str, int] = {}
    for o in moved:
        counts[o.decision.folder] = counts.get(o.decision.folder, 0) + 1
    if counts:
        lines.extend(["", "## Répartition", ""])
        lines.extend(f"- {folder} : {count}" for folder, count in sorted(counts.items()))

    errors = [o for o in report.errors if not (o.decision and o.decision.urgent)]
    if errors:
        lines.extend(["", "## Erreurs", ""])
        lines.extend(f"- {o.mail.subject} : {o.error}" for o in errors)
    return "\n".join(lines) + "\n"
