"""Logique de l'agent : décider où ranger chaque mail, l'appliquer, annuler, résumer."""
from __future__ import annotations

import json
import math
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterator, Protocol

from .classifier import Verdict
from .config import (
    ACTION_LABEL, EXTRA_LABELS, REVIEW_LABEL, URGENT_FOLDER, URGENT_LABEL, Category, FatalError, Settings,
)
from .files import write_atomic


class Mailbox(Protocol):
    """Ce dont l'agent a besoin de la boîte mail (implémenté par GraphClient)."""

    def iter_inbox_messages(self, since_days: int | None = None) -> Iterator[dict]: ...
    def get_body(self, message_id: str) -> str: ...
    def get_message(self, message_id: str) -> dict: ...
    def folder_name(self, folder_id: str) -> str: ...
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


class RunLock:
    """Empêche deux passages simultanés (tâche planifiée et lancement manuel, par exemple)."""

    STALE_AFTER = 3 * 3600  # un verrou plus vieux vient d'un passage arrêté brutalement

    def __init__(self, home: Path):
        self._path = home / "agent.lock"
        self._token = uuid.uuid4().hex

    def __enter__(self) -> "RunLock":
        self._path.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self._path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                try:
                    age = time.time() - self._path.stat().st_mtime
                except FileNotFoundError:
                    continue  # libéré entre-temps
                if age < self.STALE_AFTER:
                    raise FatalError(
                        "Un autre passage de l'agent est en cours. Réessayez plus tard "
                        f"(si aucun ne tourne, supprimez {self._path})."
                    )
                self._path.unlink(missing_ok=True)
                continue
            with os.fdopen(fd, "w") as handle:
                handle.write(self._token)
            return self
        raise FatalError(f"Impossible de prendre le verrou {self._path}.")

    def __exit__(self, *exc_info) -> None:
        # Ne retire que son propre verrou : s'il a été repris (jugé abandonné), il est à un autre.
        try:
            if self._path.read_text() == self._token:
                self._path.unlink()
        except FileNotFoundError:
            pass


class StateStore:
    """Mails déjà traités, et les catégories que l'agent leur a posées.

    Un mail laissé dans la boîte de réception n'est pas ré-analysé. Retenir les catégories posées
    par l'agent permet de ne jamais retirer une catégorie de l'utilisateur, même de même nom.
    """

    # Seuls les mails rangés hors de la boîte de réception sont oubliés au-delà de ce nombre :
    # ceux qui y sont restés ne doivent jamais être ré-analysés.
    MAX_MOVED_ENTRIES = 5000
    # Un mail qui échoue autant de fois de suite est laissé tel quel, pour ne pas le renvoyer
    # à l'IA indéfiniment.
    MAX_FAILURES = 3

    def __init__(self, path: Path):
        self._path = path
        self._entries: dict[str, dict] = {}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                data = {}
            processed = data.get("processed") if isinstance(data, dict) else None
            if isinstance(processed, dict):
                self._entries = {
                    mail_id: entry if isinstance(entry, dict) else {"time": str(entry), "labels": []}
                    for mail_id, entry in processed.items()
                }

    def seen(self, mail_id: str) -> bool:
        """Traité jusqu'au bout. Un traitement interrompu sera repris au prochain passage."""
        entry = self._entries.get(mail_id)
        return entry is not None and entry.get("done", True)

    def agent_labels(self, mail_id: str) -> list[str]:
        labels = self._entries.get(mail_id, {}).get("labels")
        return list(labels) if isinstance(labels, list) else []

    def mark(self, mail_id: str, labels: list[str], *, done: bool = True, moved: bool = False) -> None:
        self._entries[mail_id] = {
            "time": datetime.now().isoformat(timespec="seconds"),
            "labels": labels, "done": done, "moved": moved,
        }

    def record_failure(self, mail_id: str) -> bool:
        """Compte un échec. Renvoie True si le mail est désormais abandonné (laissé tel quel)."""
        entry = self._entries.get(mail_id)
        failures = int((entry or {}).get("failures", 0)) + 1
        give_up = failures >= self.MAX_FAILURES
        self._entries[mail_id] = {
            **(entry or {"labels": [], "moved": False}),
            "time": datetime.now().isoformat(timespec="seconds"),
            "failures": failures,
            "done": give_up or self.seen(mail_id),
        }
        return give_up

    def save(self) -> None:
        moved = sorted(
            (item for item in self._entries.items() if item[1].get("moved")),
            key=lambda item: str(item[1].get("time", "")),
        )
        forgotten = {mail_id for mail_id, _ in moved[:-self.MAX_MOVED_ENTRIES]}
        kept = {mail_id: entry for mail_id, entry in self._entries.items() if mail_id not in forgotten}
        write_atomic(self._path, json.dumps({"processed": kept}, ensure_ascii=False))


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

    def mark_item_undone(self, run_id: str, mail_id: str) -> None:
        self.append({"undone_item": run_id, "id": mail_id, "time": datetime.now().isoformat(timespec="seconds")})

    def undone_items(self) -> set[tuple[str, str]]:
        return {(entry["undone_item"], entry["id"]) for entry in self._lines()
                if "undone_item" in entry and "id" in entry}

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
    note: str = ""


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
        run_id = f"{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"
        report = RunReport(run_id=run_id, apply=apply)
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
                if apply:
                    self.state.save()  # après chaque mail : même un arrêt brutal ne perd rien
        finally:
            if apply:
                self.state.save()
        return report

    def _process(self, raw: dict, apply: bool, folders: dict[str, str], run_id: str) -> Outcome:
        # Une erreur propre à un mail ne doit pas arrêter les autres ; une erreur qui les toucherait
        # tous (FatalError : clé refusée, connexion expirée...) arrête le passage.
        try:
            mail = Mail.from_graph(raw, self.mailbox.get_body(raw["id"]), self.settings.body_chars)
        except FatalError:
            raise
        except Exception as exc:
            return self._failed(Outcome(Mail.from_graph(raw, "", 0), None, error=f"lecture : {exc}"), apply)
        try:
            decision = decide(self.classify(mail), self.categories, self.settings.min_confidence)
        except FatalError:
            raise
        except Exception as exc:
            return self._failed(Outcome(mail, None, error=f"classement : {exc}"), apply)

        outcome = Outcome(mail, decision)
        if apply:
            try:
                self._apply(mail, decision, folders, run_id)
                outcome.applied = True
            except FatalError:
                raise
            except Exception as exc:
                outcome.error = f"application : {exc}"
                self._failed(outcome, apply)
        return outcome

    def _failed(self, outcome: Outcome, apply: bool) -> Outcome:
        if apply and self.state.record_failure(outcome.mail.id):
            outcome.error += f" (abandonné après {StateStore.MAX_FAILURES} échecs : mail laissé tel quel)"
        return outcome

    def _apply(self, mail: Mail, decision: Decision, folders: dict[str, str], run_id: str) -> None:
        """Pose catégories, drapeau et dossier, et note dans l'état ce qui appartient à l'agent."""
        # Un re-classement remplace les catégories posées auparavant par l'agent ; celles de
        # l'utilisateur restent, et une catégorie qu'il avait déjà n'est jamais considérée comme à l'agent.
        owned_before = self.state.agent_labels(mail.id)
        kept = [label for label in mail.categories if label not in owned_before]
        owned = [label for label in decision.labels if label not in kept]
        labels = kept + owned
        flag_status = "flagged" if decision.flag and mail.flag_status == "notFlagged" else None
        self.mailbox.update_message(mail.id, categories=labels, flag_status=flag_status)
        # Noté tout de suite : si le déplacement échoue, le prochain passage reprend ce mail
        # en sachant quelles catégories sont à l'agent.
        self.state.mark(mail.id, owned, done=False)

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
        self.state.mark(mail.id, owned, moved=entry["moved_to"] is not None)

    def undo(self, *, apply: bool, run_id: str | None = None) -> list[UndoItem]:
        """Remet les mails d'un passage dans la boîte de réception et retire ce que l'agent a posé.

        Seuls les changements de l'agent sont défaits : une catégorie ou un drapeau ajoutés
        ensuite par l'utilisateur sont conservés, et un mail qu'il a déplacé ou supprimé depuis
        reste où il est. Sans `run_id`, annule le dernier passage qui ne l'a pas déjà été.
        Rien n'est rejoué : ni un passage déjà annulé, ni un mail déjà remis lors d'une annulation
        interrompue ; un mail modifié par un passage plus récent attend que celui-ci soit annulé.
        """
        entries = self.log.entries()
        undone = self.log.undone_runs()
        active = list(dict.fromkeys(entry["run_id"] for entry in entries if entry["run_id"] not in undone))
        if run_id is None:
            if not active:
                return []
            run_id = active[-1]
        elif run_id not in active:
            return []  # passage inconnu ou déjà annulé

        later_runs = set(active[active.index(run_id) + 1:])
        touched_later = {entry["id"] for entry in entries if entry["run_id"] in later_runs}
        items = [UndoItem(entry) for entry in entries if entry["run_id"] == run_id]
        already_restored = self.log.undone_items()
        for item in items:
            if (run_id, item.entry["id"]) in already_restored:
                item.restored, item.note = True, "déjà remis lors d'une annulation précédente"
            elif item.entry["id"] in touched_later:
                item.error = "modifié par un passage plus récent : annulez d'abord celui-ci"
        if not apply:
            return items

        for item in items:
            if item.error or item.restored:
                continue
            entry = item.entry
            try:
                current = self.mailbox.get_message(entry["id"])
                categories = [c for c in current.get("categories") or [] if c not in entry["added_labels"]]
                categories += [c for c in entry["removed_labels"] if c not in categories]
                current_flag = (current.get("flag") or {}).get("flagStatus")
                flag_status = "notFlagged" if entry["flag_set"] and current_flag == "flagged" else None
                self.mailbox.update_message(entry["id"], categories=categories, flag_status=flag_status)
                if entry["moved_to"]:
                    parent = current.get("parentFolderId")
                    where = self.mailbox.folder_name(parent) if parent else ""
                    if where.casefold() == entry["moved_to"].casefold():
                        self.mailbox.move_message(entry["id"], "inbox")
                    else:
                        item.note = f"laissé dans « {where or 'dossier inconnu'} », où il a été déplacé depuis"
                self.state.mark(entry["id"], list(entry.get("owned_before") or []))
                self.log.mark_item_undone(run_id, entry["id"])
                item.restored = True
            except FatalError:
                self.state.save()
                raise
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


def save_digest(home: Path, report: RunReport, digest: str) -> Path | None:
    """Garde le résumé : dernier passage utile + historique du jour, ou dernière simulation.

    Un passage sans aucun mail analysé n'écrase rien : avec une tâche toutes les 15 minutes,
    le résumé des urgents resterait sinon visible un quart d'heure seulement.
    """
    if not report.outcomes:
        return None
    if not report.apply:
        write_atomic(home / "simulation.md", digest)
        return home / "simulation.md"
    write_atomic(home / "dernier_resume.md", digest)
    day = home / "resumes" / f"{datetime.now():%Y-%m-%d}.md"
    day.parent.mkdir(parents=True, exist_ok=True)
    with day.open("a", encoding="utf-8") as handle:
        handle.write(digest + "\n")
    return home / "dernier_resume.md"


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
