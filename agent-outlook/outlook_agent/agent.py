"""Logique de l'agent : décider où ranger chaque mail, l'appliquer, annuler, résumer."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Protocol

from .classifier import Verdict
from .config import (
    ACTION_LABEL, EXTRA_LABELS, REVIEW_LABEL, URGENT_FOLDER, URGENT_LABEL, Category, Settings,
)


class Mailbox(Protocol):
    """Ce dont l'agent a besoin de la boîte mail (implémenté par GraphClient)."""

    def list_inbox_messages(self, limit: int, since_days: int | None = None) -> list[dict]: ...
    def update_message(self, message_id: str, categories: list[str] | None = None,
                       flag_status: str | None = None) -> None: ...
    def move_message(self, message_id: str, destination: str) -> None: ...
    def child_folders(self) -> dict[str, str]: ...
    def create_folder(self, name: str) -> str: ...
    def master_categories(self) -> set[str]: ...
    def create_master_category(self, name: str, color: str) -> None: ...


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
    is_event: bool

    @classmethod
    def from_graph(cls, raw: dict, body_chars: int) -> "Mail":
        address = (raw.get("from") or {}).get("emailAddress") or {}
        text = re.sub(r"\s+", " ", (raw.get("body") or {}).get("content") or "").strip()
        return cls(
            id=raw["id"],
            subject=raw.get("subject") or "(sans objet)",
            sender=address.get("name") or "",
            address=address.get("address") or "",
            received=raw.get("receivedDateTime") or "",
            body=text[:body_chars],
            has_attachments=bool(raw.get("hasAttachments")),
            importance=raw.get("importance") or "normal",
            categories=list(raw.get("categories") or []),
            flag_status=(raw.get("flag") or {}).get("flagStatus") or "notFlagged",
            # Invitations et réponses de réunion : on les laisse là où Outlook les attend.
            is_event="eventMessage" in (raw.get("@odata.type") or ""),
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
    if verdict is None or verdict.category not in by_key:
        return Decision(None, None, (REVIEW_LABEL,), False, False, False, 0.0, "",
                        "classement impossible, laissé en boîte de réception")

    category = by_key[verdict.category]
    confidence = min(max(verdict.confidence, 0.0), 1.0)
    common = dict(urgent=verdict.urgent, action_required=verdict.action_required,
                  confidence=confidence, summary=verdict.summary)

    if confidence < min_confidence:
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


class StateStore:
    """Mails déjà traités : un mail laissé dans la boîte de réception n'est pas ré-analysé."""

    MAX_ENTRIES = 5000

    def __init__(self, path: Path):
        self._path = path
        self._seen: dict[str, str] = {}
        if path.exists():
            try:
                self._seen = json.loads(path.read_text(encoding="utf-8")).get("processed", {})
            except json.JSONDecodeError:
                self._seen = {}

    def seen(self, mail_id: str) -> bool:
        return mail_id in self._seen

    def mark(self, mail_id: str) -> None:
        self._seen[mail_id] = datetime.now().isoformat(timespec="seconds")

    def save(self) -> None:
        recent = dict(sorted(self._seen.items(), key=lambda item: item[1])[-self.MAX_ENTRIES:])
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"processed": recent}, ensure_ascii=False), encoding="utf-8")


class ActionLog:
    """Journal de ce qui a été modifié, pour pouvoir annuler un passage."""

    def __init__(self, path: Path):
        self._path = path

    def append(self, entry: dict) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def entries(self) -> list[dict]:
        if not self._path.exists():
            return []
        lines = self._path.read_text(encoding="utf-8").splitlines()
        return [json.loads(line) for line in lines if line.strip()]


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

        for raw in self.mailbox.list_inbox_messages(limit, since_days):
            mail = Mail.from_graph(raw, self.settings.body_chars)
            if mail.is_event:
                report.skipped_events += 1
                continue
            if not reprocess and self.state.seen(mail.id):
                report.skipped_seen += 1
                continue
            try:
                decision = decide(self.classify(mail), self.categories, self.settings.min_confidence)
            except Exception as exc:  # une erreur sur un mail ne doit pas arrêter les autres
                report.outcomes.append(Outcome(mail, None, error=f"classement : {exc}"))
                continue

            outcome = Outcome(mail, decision)
            report.outcomes.append(outcome)
            if apply:
                try:
                    self._apply(mail, decision, folders, report.run_id)
                    outcome.applied = True
                    self.state.mark(mail.id)
                except Exception as exc:
                    outcome.error = f"application : {exc}"

        if apply:
            self.state.save()
        return report

    def _apply(self, mail: Mail, decision: Decision, folders: dict[str, str], run_id: str) -> None:
        labels = mail.categories + [label for label in decision.labels if label not in mail.categories]
        flag_status = "flagged" if decision.flag and mail.flag_status == "notFlagged" else None
        self.mailbox.update_message(mail.id, categories=labels, flag_status=flag_status)

        entry = {
            "run_id": run_id,
            "time": datetime.now().isoformat(timespec="seconds"),
            "id": mail.id,
            "subject": mail.subject[:100],
            "sender": mail.address,
            "previous_categories": mail.categories,
            "previous_flag": mail.flag_status,
            "moved_to": None,
        }
        try:
            if decision.folder:
                key = decision.folder.casefold()
                if key not in folders:
                    folders[key] = self.mailbox.create_folder(decision.folder)
                self.mailbox.move_message(mail.id, folders[key])
                entry["moved_to"] = decision.folder
        finally:
            self.log.append(entry)

    def undo(self, *, apply: bool, run_id: str | None = None) -> list[UndoItem]:
        """Remet les mails d'un passage dans la boîte de réception, avec leurs catégories d'origine."""
        entries = self.log.entries()
        if not entries:
            return []
        run_id = run_id or entries[-1]["run_id"]
        items = [UndoItem(entry) for entry in entries if entry["run_id"] == run_id]
        if not apply:
            return items
        for item in items:
            entry = item.entry
            try:
                self.mailbox.update_message(
                    entry["id"], categories=entry["previous_categories"], flag_status=entry["previous_flag"]
                )
                if entry["moved_to"]:
                    self.mailbox.move_message(entry["id"], "inbox")
                item.restored = True
            except Exception as exc:
                item.error = str(exc)
        return items


def setup_mailbox(mailbox: Mailbox, categories: tuple[Category, ...]) -> list[str]:
    """Crée les dossiers et, si la permission le permet, les catégories de couleur."""
    messages = []
    folders = mailbox.child_folders()
    for name in [category.folder for category in categories] + [URGENT_FOLDER]:
        if name.casefold() in folders:
            messages.append(f"Dossier déjà présent : {name}")
        else:
            folders[name.casefold()] = mailbox.create_folder(name)
            messages.append(f"Dossier créé : {name}")

    wanted = {category.label: category.color for category in categories} | EXTRA_LABELS
    try:
        existing = mailbox.master_categories()
        for label, color in wanted.items():
            if label.casefold() in existing:
                messages.append(f"Catégorie déjà présente : {label}")
            else:
                mailbox.create_master_category(label, color)
                messages.append(f"Catégorie créée : {label}")
    except Exception as exc:
        messages.append(
            "Catégories de couleur non créées (permission MailboxSettings.ReadWrite absente ?) : "
            "les catégories fonctionneront quand même, sans couleur tant que vous ne leur en "
            f"donnez pas une dans Outlook. Détail : {exc}"
        )
    return messages


def render_digest(report: RunReport) -> str:
    """Résumé en français de ce qui demande l'attention, au format Markdown."""
    mode = "simulation, rien n'a été modifié" if not report.apply else "tri appliqué"
    classified = [o for o in report.outcomes if o.decision]
    left = [o for o in classified if o.decision.folder is None]
    lines = [
        f"# Résumé du tri du {datetime.now():%d/%m/%Y à %H:%M} ({mode})",
        "",
        f"{len(report.outcomes)} mails analysés : {len(classified) - len(left)} à ranger, "
        f"{len(left)} laissés en boîte de réception, {len(report.errors)} en erreur. "
        f"Ignorés : {report.skipped_seen} déjà traités, {report.skipped_events} invitations.",
    ]

    def section(title: str, selected: list[Outcome]) -> None:
        if not selected:
            return
        lines.extend(["", f"## {title}", ""])
        for o in selected:
            where = o.decision.folder or "boîte de réception"
            lines.append(f"- **{o.mail.subject}** ({o.mail.sender or o.mail.address}) → {where}. "
                         f"{o.decision.summary}".rstrip())

    section("Urgents", [o for o in classified if o.decision.urgent])
    section("Actions à mener", [o for o in classified if o.decision.action_required and not o.decision.urgent])
    section("Laissés en boîte de réception, à vérifier", [o for o in left if not o.decision.urgent])

    counts: dict[str, int] = {}
    for o in classified:
        if o.decision.folder:
            counts[o.decision.folder] = counts.get(o.decision.folder, 0) + 1
    if counts:
        lines.extend(["", "## Répartition", ""])
        lines.extend(f"- {folder} : {count}" for folder, count in sorted(counts.items()))

    if report.errors:
        lines.extend(["", "## Erreurs", ""])
        lines.extend(f"- {o.mail.subject} : {o.error}" for o in report.errors)
    return "\n".join(lines) + "\n"
