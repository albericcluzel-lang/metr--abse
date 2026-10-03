"""Logique de l'agent : décider où ranger chaque mail, l'appliquer, annuler, résumer."""
from __future__ import annotations

import json
import math
import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterator, Protocol

from .classifier import Verdict
from .config import (
    ACTION_LABEL, EXTRA_LABELS, REVIEW_LABEL, URGENT_FOLDER, URGENT_LABEL, Category, FatalError, Settings,
)
from .files import write_atomic

# Autant d'erreurs de suite, sur des mails qui n'avaient encore jamais échoué, font arrêter le
# passage : un service est sans doute en panne, inutile d'attendre des heures que chaque mail
# épuise ses nouvelles tentatives.
MAX_CONSECUTIVE_ERRORS = 5
# Marge de relecture avant le point de reprise (mail daté un peu avant son arrivée dans la boîte).
WATERMARK_MARGIN = timedelta(days=1)
# Relecture complète de la boîte au moins aussi souvent : rattrape un mail revenu en boîte de
# réception avec une date ancienne (sorti des indésirables, ramené d'un autre dossier) et les mails
# restés en suspens hors de la fenêtre lue.
FULL_SCAN_EVERY = timedelta(hours=24)


class Mailbox(Protocol):
    """Ce dont l'agent a besoin de la boîte mail (implémenté par GraphClient)."""

    def iter_inbox_messages(self, since: datetime | None = None) -> Iterator[dict]: ...
    def inbox_folder(self) -> dict: ...
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


class MovedByUser(Exception):
    """Le mail n'est plus dans la boîte de réception au moment de le ranger."""


def is_meeting_message(raw: dict) -> bool:
    """Invitations et réponses de réunion : on les laisse là où Outlook les attend."""
    return "eventMessage" in (raw.get("@odata.type") or "")


def _from_iso(value) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def received_at(raw: dict) -> datetime | None:
    """Date de réception donnée par le serveur Microsoft (indépendante de l'horloge du PC)."""
    moment = _from_iso(raw.get("receivedDateTime")) if raw.get("receivedDateTime") else None
    if moment and moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


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
    note: str = ""  # traitement abandonné sans erreur (ex. mail déplacé par l'utilisateur entre-temps)


@dataclass
class RunReport:
    run_id: str
    apply: bool
    outcomes: list[Outcome] = field(default_factory=list)
    skipped_seen: int = 0
    skipped_events: int = 0
    aborted: str | None = None  # raison d'un arrêt avant la fin (clé refusée, panne...)
    warnings: list[str] = field(default_factory=list)

    @property
    def errors(self) -> list[Outcome]:
        return [outcome for outcome in self.outcomes if outcome.error]


class RunLock:
    """Empêche deux passages simultanés (tâche planifiée et lancement manuel, par exemple).

    Verrou du système d'exploitation : il est libéré automatiquement si le programme s'arrête
    brutalement, il n'y a donc jamais de verrou abandonné à deviner.
    """

    def __init__(self, home: Path):
        self._path = home / "agent.lock"
        self._handle = None

    def __enter__(self) -> "RunLock":
        self._path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self._path, "a+")
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            raise FatalError("Un autre passage de l'agent est en cours. Réessayez plus tard.") from None
        self._handle = handle
        return self

    def __exit__(self, *exc_info) -> None:
        self._handle.close()  # fermer le fichier libère le verrou


class StateStore:
    """Mails déjà traités, ce que l'agent leur a posé (catégories, drapeau) et où reprendre la lecture.

    Un mail laissé dans la boîte de réception n'est pas ré-analysé. Retenir ce que l'agent a posé
    permet de ne jamais retirer une catégorie ou un drapeau de l'utilisateur.
    """

    # Seuls les mails rangés hors de la boîte de réception sont oubliés au-delà de ce nombre :
    # ceux qui y sont restés ne doivent jamais être ré-analysés.
    MAX_MOVED_ENTRIES = 5000
    # Un mail qui échoue au moins MAX_FAILURES fois (au plus une fois comptée par FAILURE_SPACING),
    # sur au moins GIVE_UP_AFTER, est laissé de côté : une panne ou une saturation passagère ne
    # suffit pas, mais un mail qui échoue à chaque fois n'est pas renvoyé à l'IA indéfiniment.
    MAX_FAILURES = 3
    FAILURE_SPACING = timedelta(hours=1)
    GIVE_UP_AFTER = timedelta(hours=24)

    def __init__(self, path: Path):
        self._path = path
        self._entries: dict[str, dict] = {}
        self._watermark: str | None = None
        self._last_full_scan: str | None = None
        self.recovered_from: Path | None = None
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            # Illisible : mis de côté plutôt qu'écrasé, et on repart d'un état vide.
            self.recovered_from = path.with_name(f"{path.name}.illisible-{datetime.now():%Y%m%d-%H%M%S}")
            os.replace(path, self.recovered_from)
            return
        if not isinstance(data, dict):
            return
        processed = data.get("processed")
        if isinstance(processed, dict):
            self._entries = {
                mail_id: entry if isinstance(entry, dict) else {"time": str(entry), "labels": []}
                for mail_id, entry in processed.items()
            }
        self._watermark = data.get("watermark") if isinstance(data.get("watermark"), str) else None
        self._last_full_scan = data.get("last_full_scan") if isinstance(data.get("last_full_scan"), str) else None

    def watermark(self) -> datetime | None:
        """Date de réception (serveur) jusqu'à laquelle tout a été traité sans erreur."""
        return _from_iso(self._watermark) if self._watermark else None

    def set_watermark(self, moment: datetime) -> None:
        current = self.watermark()
        if current is None or moment > current:
            self._watermark = moment.isoformat(timespec="seconds")

    def last_full_scan(self) -> datetime | None:
        return _from_iso(self._last_full_scan) if self._last_full_scan else None

    def set_last_full_scan(self, moment: datetime) -> None:
        self._last_full_scan = moment.isoformat(timespec="seconds")

    def seen(self, mail_id: str) -> bool:
        """Traité jusqu'au bout. Un traitement interrompu sera repris au prochain passage."""
        entry = self._entries.get(mail_id)
        return entry is not None and entry.get("done", True)

    def agent_labels(self, mail_id: str) -> list[str]:
        labels = self._entries.get(mail_id, {}).get("labels")
        return list(labels) if isinstance(labels, list) else []

    def agent_flagged(self, mail_id: str) -> bool:
        return bool(self._entries.get(mail_id, {}).get("flagged"))

    def failure_count(self, mail_id: str) -> int:
        return int(self._entries.get(mail_id, {}).get("failures", 0))

    def mark(self, mail_id: str, labels: list[str], *, flagged: bool = False,
             done: bool = True, moved: bool = False) -> None:
        previous = self._entries.get(mail_id) or {}
        entry = {
            "time": datetime.now().isoformat(timespec="seconds"),
            "labels": labels, "flagged": flagged, "done": done, "moved": moved,
        }
        if not done:  # traitement pas encore abouti : le compte des échecs continue
            entry.update({key: previous[key] for key in ("failures", "first_failure", "last_failure")
                          if key in previous})
        self._entries[mail_id] = entry

    def add_agent_label(self, mail_id: str, label: str) -> None:
        entry = self._entries.setdefault(mail_id, {"labels": []})
        entry["labels"] = self.agent_labels(mail_id) + [label]

    def record_failure(self, mail_id: str, now: datetime | None = None) -> bool:
        """Compte un échec. Renvoie True si le mail est désormais laissé de côté."""
        now = now or datetime.now()
        entry = self._entries.get(mail_id) or {"labels": [], "moved": False}
        failures = int(entry.get("failures", 0))
        first = _from_iso(entry.get("first_failure")) or now
        last = _from_iso(entry.get("last_failure"))
        if last is None or now - last >= self.FAILURE_SPACING:
            failures, last = failures + 1, now
        give_up = failures >= self.MAX_FAILURES and now - first >= self.GIVE_UP_AFTER
        self._entries[mail_id] = {
            **entry,
            "time": now.isoformat(timespec="seconds"),
            "failures": failures,
            "first_failure": first.isoformat(timespec="seconds"),
            "last_failure": last.isoformat(timespec="seconds"),
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
        data = {"processed": kept, "watermark": self._watermark, "last_full_scan": self._last_full_scan}
        write_atomic(self._path, json.dumps(data, ensure_ascii=False))


class ActionLog:
    """Journal de ce qui a été modifié, pour pouvoir annuler un passage."""

    REQUIRED_KEYS = {"run_id", "id", "added_labels", "removed_labels", "flag_change", "moved_to"}

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

    def undone_items(self) -> set[tuple[str, str]]:
        return {(entry["undone_item"], entry["id"]) for entry in self._lines()
                if "undone_item" in entry and "id" in entry}


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
        started = datetime.now(timezone.utc)
        run_id = f"{started.astimezone():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"
        report = RunReport(run_id=run_id, apply=apply)
        since, exhausted, newest = None, False, None
        try:
            folders = self.mailbox.child_folders()
            inbox = self.mailbox.inbox_folder() if apply else {}
            since = self._since(since_days, reprocess)
            pending, exhausted, newest = self._pending(report, limit, since, reprocess)
            consecutive_errors = 0
            for raw in pending:
                already_failing = self.state.failure_count(raw["id"]) > 0
                outcome = self._process(raw, apply, folders, inbox, report.run_id)
                report.outcomes.append(outcome)
                if apply:
                    self._save_state(report)  # après chaque mail : même un arrêt brutal ne perd rien
                if not outcome.error:
                    consecutive_errors = 0
                elif not already_failing:  # un mail qui échouait déjà ne signale pas une panne
                    consecutive_errors += 1
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    report.aborted = (f"{consecutive_errors} erreurs de suite, service probablement "
                                      f"indisponible : {outcome.error}")
                    break
        except FatalError as exc:
            # Erreur qui toucherait tous les mails : on s'arrête, mais le rapport (et donc le
            # résumé des mails déjà rangés) est conservé.
            report.aborted = str(exc)
        finally:
            if apply:
                self._save_state(report)

        if apply:
            for outcome in report.errors:
                if self.state.record_failure(outcome.mail.id):
                    self._give_up(outcome, report.run_id)
            # Le point de reprise n'avance que si tout ce qui attendait a été traité sans erreur :
            # sinon les mails restants (ou à reprendre) sortiraient de la fenêtre lue.
            if exhausted and not report.errors and not report.aborted and since_days is None and not reprocess:
                if newest:
                    self.state.set_watermark(newest)
                if since is None:
                    self.state.set_last_full_scan(started)
            self._save_state(report)
        return report

    def _save_state(self, report: RunReport) -> None:
        try:
            self.state.save()
        except OSError as exc:  # fichier bloqué (antivirus, indexation...) : on continue
            if not report.warnings:
                report.warnings.append(f"État non enregistré ({exc}) : des mails pourront être ré-analysés.")

    def _since(self, since_days: int | None, reprocess: bool) -> datetime | None:
        """Date de réception à partir de laquelle lire : choix explicite, sinon point de reprise."""
        if since_days is not None:
            return datetime.now(timezone.utc) - timedelta(days=since_days)
        watermark, last_full = self.state.watermark(), self.state.last_full_scan()
        if reprocess or watermark is None or last_full is None:
            return None
        if datetime.now(timezone.utc) - last_full >= FULL_SCAN_EVERY:
            return None
        return watermark - WATERMARK_MARGIN

    def _pending(self, report: RunReport, limit: int, since: datetime | None,
                 reprocess: bool) -> tuple[list[dict], bool, datetime | None]:
        """Mails à analyser, si la liste a été lue jusqu'au bout, et la réception la plus récente."""
        # Liste complète avant toute modification : déplacer des mails pendant la pagination
        # décalerait les pages suivantes. `limit` compte les mails à analyser, pas ceux ignorés,
        # pour que des mails déjà traités restés en boîte de réception ne bloquent pas les plus anciens.
        pending: list[dict] = []
        newest = None
        for raw in self.mailbox.iter_inbox_messages(since):
            moment = received_at(raw)
            if moment and (newest is None or moment > newest):
                newest = moment
            if is_meeting_message(raw):
                report.skipped_events += 1
            elif not reprocess and self.state.seen(raw["id"]):
                report.skipped_seen += 1
            else:
                pending.append(raw)
                if len(pending) >= limit:
                    return pending, False, newest
        return pending, True, newest

    def _process(self, raw: dict, apply: bool, folders: dict[str, str], inbox: dict, run_id: str) -> Outcome:
        # Une erreur propre à un mail ne doit pas arrêter les autres ; une erreur qui les toucherait
        # tous (FatalError : clé refusée, connexion expirée...) arrête le passage.
        try:
            mail = Mail.from_graph(raw, self.mailbox.get_body(raw["id"]), self.settings.body_chars)
        except FatalError:
            raise
        except Exception as exc:
            return Outcome(Mail.from_graph(raw, "", 0), None, error=f"lecture : {exc}")
        try:
            decision = decide(self.classify(mail), self.categories, self.settings.min_confidence)
        except FatalError:
            raise
        except Exception as exc:
            return Outcome(mail, None, error=f"classement : {exc}")

        outcome = Outcome(mail, decision)
        if apply:
            try:
                self._apply(mail, decision, folders, inbox, run_id)
                outcome.applied = True
            except MovedByUser:
                outcome.note = "déplacé ou supprimé pendant le passage : laissé tel quel"
                self.state.mark(mail.id, self.state.agent_labels(mail.id),
                                flagged=self.state.agent_flagged(mail.id))
            except FatalError:
                raise
            except Exception as exc:
                outcome.error = f"application : {exc}"
        return outcome

    def _still_in_inbox(self, current: dict, inbox: dict) -> bool:
        parent = current.get("parentFolderId")
        if not parent or parent == inbox.get("id"):
            return True
        # Un même dossier peut avoir deux écritures d'identifiant : on compare aussi son nom.
        return self.mailbox.folder_name(parent) == inbox.get("displayName")

    @staticmethod
    def _log_entry(run_id: str, mail: Mail, *, added: list[str], removed: list[str],
                   owned_before: list[str], flagged_before: bool, flag_change: str | None = None) -> dict:
        return {
            "run_id": run_id,
            "time": datetime.now().isoformat(timespec="seconds"),
            "id": mail.id,
            "subject": mail.subject[:100],
            "sender": mail.address,
            "added_labels": added,
            "removed_labels": removed,
            "owned_before": owned_before,
            "flagged_before": flagged_before,
            "flag_change": flag_change,
            "moved_to": None,
        }

    def _give_up(self, outcome: Outcome, run_id: str) -> None:
        """Mail qui échoue sans cesse : laissé en boîte de réception, marqué « À vérifier »."""
        mail = outcome.mail
        try:
            categories = self.mailbox.get_message(mail.id).get("categories") or []
            if REVIEW_LABEL not in categories:
                owned_before = self.state.agent_labels(mail.id)
                self.mailbox.update_message(mail.id, categories=categories + [REVIEW_LABEL])
                self.state.add_agent_label(mail.id, REVIEW_LABEL)
                # Journalisé comme le reste, pour qu'une annulation retire aussi cette catégorie.
                self.log.append(self._log_entry(
                    run_id, mail, added=[REVIEW_LABEL], removed=[], owned_before=owned_before,
                    flagged_before=self.state.agent_flagged(mail.id),
                ))
            outcome.error += f" (laissé de côté après {StateStore.MAX_FAILURES} échecs, marqué « {REVIEW_LABEL} »)"
        except Exception:
            outcome.error += f" (laissé de côté après {StateStore.MAX_FAILURES} échecs)"

    def _apply(self, mail: Mail, decision: Decision, folders: dict[str, str], inbox: dict, run_id: str) -> None:
        """Pose catégories, drapeau et dossier, et note dans l'état ce qui appartient à l'agent."""
        # Relu juste avant d'écrire : la liste a pu être lue plusieurs minutes plus tôt. Un mail
        # déplacé ou supprimé entre-temps n'est pas touché, et une catégorie ajoutée n'est pas effacée.
        current = self.mailbox.get_message(mail.id)
        if not self._still_in_inbox(current, inbox):
            raise MovedByUser
        categories = list(current.get("categories") or [])
        flag_now = (current.get("flag") or {}).get("flagStatus") or "notFlagged"
        # Un re-classement remplace ce que l'agent avait posé ; ce que l'utilisateur a posé reste,
        # et une catégorie ou un drapeau qu'il avait déjà ne sont jamais considérés comme à l'agent.
        owned_before = self.state.agent_labels(mail.id)
        flagged_before = self.state.agent_flagged(mail.id)
        kept = [label for label in categories if label not in owned_before]
        owned = [label for label in decision.labels if label not in kept]
        labels = kept + owned
        if decision.flag and flag_now == "notFlagged":
            flag_change = "set"
        elif not decision.flag and flagged_before and flag_now == "flagged":
            flag_change = "cleared"
        else:
            flag_change = None
        flagged = flag_change == "set" or (decision.flag and flagged_before)

        self.mailbox.update_message(
            mail.id, categories=labels,
            flag_status={"set": "flagged", "cleared": "notFlagged"}.get(flag_change),
        )
        # Noté tout de suite : si le déplacement échoue, le prochain passage reprend ce mail
        # en sachant ce qui est à l'agent.
        self.state.mark(mail.id, owned, flagged=flagged, done=False)

        entry = self._log_entry(
            run_id, mail,
            added=[label for label in labels if label not in categories],
            removed=[label for label in categories if label not in labels],
            owned_before=owned_before, flagged_before=flagged_before, flag_change=flag_change,
        )
        try:
            if decision.folder:
                folder_id, _ = ensure_folder(self.mailbox, folders, decision.folder)
                self.mailbox.move_message(mail.id, folder_id)
                entry["moved_to"] = decision.folder
        finally:
            self.log.append(entry)
        self.state.mark(mail.id, owned, flagged=flagged, moved=entry["moved_to"] is not None)

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

        already_restored = self.log.undone_items()
        later_runs = set(active[active.index(run_id) + 1:])
        # Un mail déjà remis par l'annulation (même partielle) d'un passage plus récent ne bloque plus.
        touched_later = {entry["id"] for entry in entries
                         if entry["run_id"] in later_runs and (entry["run_id"], entry["id"]) not in already_restored}
        items = [UndoItem(entry) for entry in entries if entry["run_id"] == run_id]
        for item in items:
            if (run_id, item.entry["id"]) in already_restored:
                item.restored, item.note = True, "déjà remis lors d'une annulation précédente"
            elif item.entry["id"] in touched_later:
                item.error = "modifié par un passage plus récent : annulez d'abord celui-ci"
        if not apply:
            return items

        try:
            # Du plus récent au plus ancien : un mail modifié deux fois dans le passage (rangement
            # puis « À vérifier ») retrouve exactement son état d'avant.
            for item in reversed(items):
                if item.error or item.restored:
                    continue
                try:
                    self._restore(item)
                except FatalError:
                    raise
                except Exception as exc:
                    if getattr(exc, "status", None) == 404:  # supprimé définitivement depuis
                        item.restored, item.note = True, "supprimé définitivement depuis, rien à remettre"
                    else:
                        item.error = str(exc)
        finally:
            # Un mail n'est noté « remis » que si toutes ses modifications du passage sont défaites.
            for mail_id in dict.fromkeys(item.entry["id"] for item in items):
                if ((run_id, mail_id) not in already_restored
                        and all(item.restored for item in items if item.entry["id"] == mail_id)):
                    self.log.mark_item_undone(run_id, mail_id)
            self.state.save()
        # Un passage annulé en partie reste la cible par défaut, pour pouvoir relancer l'annulation.
        if all(item.restored for item in items):
            self.log.mark_undone(run_id)
        return items

    def _restore(self, item: UndoItem) -> None:
        entry = item.entry
        current = self.mailbox.get_message(entry["id"])
        categories = [c for c in current.get("categories") or [] if c not in entry["added_labels"]]
        categories += [c for c in entry["removed_labels"] if c not in categories]
        current_flag = (current.get("flag") or {}).get("flagStatus")
        flag_status = None
        if entry["flag_change"] == "set" and current_flag == "flagged":
            flag_status = "notFlagged"
        elif entry["flag_change"] == "cleared" and current_flag == "notFlagged":
            flag_status = "flagged"
        self.mailbox.update_message(entry["id"], categories=categories, flag_status=flag_status)

        if entry["moved_to"]:
            parent = current.get("parentFolderId")
            where = self.mailbox.folder_name(parent) if parent else ""
            if where.casefold() == entry["moved_to"].casefold():
                self.mailbox.move_message(entry["id"], "inbox")
            else:
                item.note = f"laissé dans « {where or 'dossier inconnu'} », où il a été déplacé depuis"
        self.state.mark(entry["id"], list(entry.get("owned_before") or []),
                        flagged=bool(entry.get("flagged_before")))
        item.restored = True


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
    done = [o for o in report.outcomes if o.decision and not o.error and not o.note]
    moved = [o for o in done if o.decision.folder]
    left = [o for o in done if not o.decision.folder]
    untouched = [o for o in report.outcomes if o.note]
    # Un mail urgent reste signalé comme tel même si son rangement a échoué.
    urgent = [o for o in report.outcomes if o.decision and o.decision.urgent and not o.note]
    summary = (f"{len(report.outcomes)} mails analysés : {len(moved)} {'rangés' if report.apply else 'à ranger'}, "
               f"{len(left)} laissés en boîte de réception, {len(report.errors)} en erreur. ")
    if untouched:
        summary += f"{len(untouched)} déplacés ou supprimés par vous pendant le passage, laissés tels quels. "
    summary += f"Ignorés : {report.skipped_seen} déjà traités, {report.skipped_events} invitations."
    lines = [f"# Résumé du tri du {datetime.now():%d/%m/%Y à %H:%M} ({mode})", "", summary]
    if report.aborted:
        lines.extend(["", f"**Passage interrompu avant la fin** : {report.aborted}"])
    for warning in report.warnings:
        lines.extend(["", f"**Attention** : {warning}"])

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
