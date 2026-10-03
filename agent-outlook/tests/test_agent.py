from dataclasses import replace
from types import SimpleNamespace

import pytest

from outlook_agent.agent import Agent, Mail, decide, render_digest, setup_mailbox
from outlook_agent.classifier import Verdict, build_system_prompt, classify
from outlook_agent.config import CATEGORIES, URGENT_FOLDER, Settings


def make_settings(tmp_path, **overrides):
    base = Settings(
        client_id="client", tenant_id="tenant", scopes=("Mail.ReadWrite",), model="test-model",
        home=tmp_path, body_chars=50, min_confidence=0.6, user_context="contexte",
    )
    return replace(base, **overrides)


def raw_mail(mail_id, subject="Sujet", body="Corps du mail", **extra):
    return {
        "id": mail_id,
        "subject": subject,
        "from": {"emailAddress": {"name": "Jean Dupont", "address": "jean@exemple.fr"}},
        "receivedDateTime": "2026-10-03T08:00:00Z",
        "body": {"contentType": "text", "content": body},
        "hasAttachments": False,
        "importance": "normal",
        "categories": [],
        "flag": {"flagStatus": "notFlagged"},
        **extra,
    }


def verdict(category="chantier", urgent=False, action_required=False, confidence=0.9, summary="Résumé"):
    return Verdict(category=category, urgent=urgent, action_required=action_required,
                   confidence=confidence, summary=summary)


class FakeMailbox:
    def __init__(self, messages, folders=None):
        self.messages = messages
        self.folders = dict(folders or {})
        self.writes = []
        # État « côté serveur » de chaque mail, tenu à jour par update_message.
        self.current = {
            m["id"]: {"categories": list(m.get("categories", [])), "flag": dict(m.get("flag", {}))}
            for m in messages
        }

    def list_inbox_messages(self, limit, since_days=None):
        return self.messages[:limit]

    def get_message(self, message_id):
        state = self.current[message_id]
        return {"categories": list(state["categories"]), "flag": dict(state["flag"])}

    def child_folders(self):
        return dict(self.folders)

    def create_folder(self, name):
        self.writes.append(("create_folder", name))
        return f"id:{name}"

    def update_message(self, message_id, categories=None, flag_status=None):
        self.writes.append(("update", message_id, categories, flag_status))
        if categories is not None:
            self.current[message_id]["categories"] = list(categories)
        if flag_status is not None:
            self.current[message_id]["flag"] = {"flagStatus": flag_status}

    def move_message(self, message_id, destination):
        self.writes.append(("move", message_id, destination))

    def master_categories(self):
        return set()

    def create_master_category(self, name, color):
        self.writes.append(("master_category", name, color))


def make_agent(tmp_path, messages, verdicts, folders=None, **settings_overrides):
    mailbox = FakeMailbox(messages, folders)
    answers = iter(verdicts)

    def fake_classify(mail):
        answer = next(answers)
        if isinstance(answer, Exception):
            raise answer
        return answer

    agent = Agent(mailbox, fake_classify, make_settings(tmp_path, **settings_overrides), CATEGORIES)
    return agent, mailbox


# --- Décision --------------------------------------------------------------------------------

def test_decide_routes_to_topic_folder():
    decision = decide(verdict("devis_factures", action_required=True), CATEGORIES, 0.6)
    assert decision.folder == "Devis et factures"
    assert decision.labels == ("Devis-Factures", "Action requise")
    assert not decision.flag


def test_decide_urgent_goes_to_urgent_folder_and_flags():
    decision = decide(verdict("securite", urgent=True), CATEGORIES, 0.6)
    assert decision.folder == URGENT_FOLDER
    assert decision.labels == ("Sécurité", "Urgent")
    assert decision.flag


def test_decide_low_confidence_stays_in_inbox_but_keeps_urgency():
    decision = decide(verdict(urgent=True, confidence=0.3), CATEGORIES, 0.6)
    assert decision.folder is None
    assert decision.labels == ("À vérifier", "Urgent")
    assert decision.flag


def test_decide_missing_or_unknown_verdict_stays_in_inbox():
    assert decide(None, CATEGORIES, 0.6).folder is None
    unknown = Verdict.model_construct(category="inconnue", urgent=False, action_required=False,
                                      confidence=1.0, summary="")
    assert decide(unknown, CATEGORIES, 0.6).folder is None


@pytest.mark.parametrize("bad", [45.0, -0.1, float("nan")])
def test_decide_does_not_trust_out_of_range_confidence(bad):
    decision = decide(verdict(confidence=bad), CATEGORIES, 0.6)
    assert decision.folder is None and decision.labels == ("À vérifier",)


# --- Lecture des mails ---------------------------------------------------------------------

def test_mail_from_graph_cleans_and_truncates_body():
    mail = Mail.from_graph(raw_mail("1", body="  ligne 1 \n\n\n ligne   2 " + "x" * 200), body_chars=20)
    assert mail.body == "ligne 1 ligne 2 xxxx"
    assert mail.sender == "Jean Dupont" and mail.address == "jean@exemple.fr"


def test_mail_from_graph_detects_meeting_messages():
    assert Mail.from_graph(raw_mail("1", **{"@odata.type": "#microsoft.graph.eventMessageRequest"}), 50).is_event
    assert not Mail.from_graph(raw_mail("1"), 50).is_event


# --- Passage de l'agent ------------------------------------------------------------------------

def test_dry_run_changes_nothing(tmp_path):
    agent, mailbox = make_agent(tmp_path, [raw_mail("1")], [verdict()])
    report = agent.run(apply=False, limit=10)
    assert mailbox.writes == []
    assert report.outcomes[0].decision.folder == "Chantier en cours"
    assert not report.outcomes[0].applied
    assert not (tmp_path / "state.json").exists()


def test_apply_labels_creates_missing_folder_and_moves(tmp_path):
    agent, mailbox = make_agent(tmp_path, [raw_mail("1", categories=["Perso"])], [verdict("fournisseurs")])
    report = agent.run(apply=True, limit=10)
    assert mailbox.writes == [
        ("update", "1", ["Perso", "Fournisseurs"], None),
        ("create_folder", "Fournisseurs et sous-traitants"),
        ("move", "1", "id:Fournisseurs et sous-traitants"),
    ]
    assert report.outcomes[0].applied


def test_apply_reuses_existing_folder_and_flags_urgent(tmp_path):
    folders = {URGENT_FOLDER.casefold(): "urgent-id"}
    agent, mailbox = make_agent(
        tmp_path, [raw_mail("1")], [verdict("chantier", urgent=True, action_required=True)], folders
    )
    agent.run(apply=True, limit=10)
    assert mailbox.writes == [
        ("update", "1", ["Chantier", "Urgent", "Action requise"], "flagged"),
        ("move", "1", "urgent-id"),
    ]


def test_apply_does_not_touch_an_existing_flag(tmp_path):
    message = raw_mail("1", flag={"flagStatus": "complete"})
    agent, mailbox = make_agent(tmp_path, [message], [verdict(urgent=True)])
    agent.run(apply=True, limit=10)
    assert mailbox.writes[0][3] is None


def test_low_confidence_mail_is_labelled_but_not_moved(tmp_path):
    agent, mailbox = make_agent(tmp_path, [raw_mail("1")], [verdict(confidence=0.2)])
    agent.run(apply=True, limit=10)
    assert mailbox.writes == [("update", "1", ["À vérifier"], None)]


def test_reclassifying_replaces_agent_labels_but_keeps_user_labels(tmp_path):
    agent, mailbox = make_agent(
        tmp_path, [raw_mail("1", categories=["Perso"])], [verdict(confidence=0.2), verdict("fournisseurs")]
    )
    agent.run(apply=True, limit=10)
    assert mailbox.current["1"]["categories"] == ["Perso", "À vérifier"]

    mailbox.messages[0]["categories"] = list(mailbox.current["1"]["categories"])
    agent.run(apply=True, limit=10, reprocess=True)
    assert mailbox.current["1"]["categories"] == ["Perso", "Fournisseurs"]

    agent.undo(apply=True)
    assert mailbox.current["1"]["categories"] == ["Perso", "À vérifier"]


def test_meeting_messages_are_left_alone(tmp_path):
    message = raw_mail("1", **{"@odata.type": "#microsoft.graph.eventMessageRequest"})
    agent, mailbox = make_agent(tmp_path, [message], [])
    report = agent.run(apply=True, limit=10)
    assert mailbox.writes == [] and report.skipped_events == 1


def test_processed_mails_are_skipped_next_time_unless_reprocess(tmp_path):
    agent, mailbox = make_agent(tmp_path, [raw_mail("1")], [verdict(confidence=0.2), verdict(confidence=0.2)])
    agent.run(apply=True, limit=10)

    again = Agent(mailbox, agent.classify, agent.settings, CATEGORIES)
    report = again.run(apply=True, limit=10)
    assert report.skipped_seen == 1 and report.outcomes == []

    forced = again.run(apply=True, limit=10, reprocess=True)
    assert len(forced.outcomes) == 1


def test_one_failing_mail_does_not_stop_the_others(tmp_path):
    messages = [raw_mail("1", "Premier"), raw_mail("2", "Second")]
    agent, mailbox = make_agent(tmp_path, messages, [RuntimeError("API en panne"), verdict()])
    report = agent.run(apply=True, limit=10)
    assert len(report.errors) == 1 and "API en panne" in report.errors[0].error
    assert any(write[:2] == ("move", "2") for write in mailbox.writes)
    assert not agent.state.seen("1") and agent.state.seen("2")


def test_failed_move_is_reported_and_retried_later(tmp_path):
    agent, mailbox = make_agent(tmp_path, [raw_mail("1")], [verdict()])

    def broken_move(message_id, destination):
        raise RuntimeError("Graph indisponible")

    mailbox.move_message = broken_move
    report = agent.run(apply=True, limit=10)
    assert "Graph indisponible" in report.errors[0].error
    assert not agent.state.seen("1")


# --- Annulation ----------------------------------------------------------------------------------

def test_undo_removes_only_agent_changes_and_moves_back(tmp_path):
    agent, mailbox = make_agent(
        tmp_path, [raw_mail("1", categories=["Perso"])], [verdict("securite", urgent=True)]
    )
    agent.run(apply=True, limit=10)
    mailbox.current["1"]["categories"].append("Client X")  # ajouté à la main après le passage
    mailbox.writes.clear()

    assert not agent.undo(apply=False)[0].restored
    assert mailbox.writes == []

    items = agent.undo(apply=True)
    assert items[0].restored
    assert mailbox.writes == [("update", "1", ["Perso", "Client X"], "notFlagged"), ("move", "1", "inbox")]


def test_undo_keeps_a_flag_the_agent_did_not_set(tmp_path):
    agent, mailbox = make_agent(tmp_path, [raw_mail("1")], [verdict()])
    agent.run(apply=True, limit=10)
    mailbox.current["1"]["flag"] = {"flagStatus": "flagged"}  # drapeau mis par l'utilisateur
    mailbox.writes.clear()
    agent.undo(apply=True)
    assert mailbox.writes[0] == ("update", "1", [], None)


def test_corrupted_state_and_truncated_log_do_not_crash(tmp_path):
    (tmp_path / "state.json").write_text("[]", encoding="utf-8")
    agent, _ = make_agent(tmp_path, [raw_mail("1")], [verdict()])
    agent.run(apply=True, limit=10)
    with (tmp_path / "actions.jsonl").open("a", encoding="utf-8") as handle:
        handle.write('{"run_id": "tronqu')  # arrêt brutal pendant l'écriture
    assert len(agent.undo(apply=False)) == 1


def test_undo_with_empty_log(tmp_path):
    agent, _ = make_agent(tmp_path, [], [])
    assert agent.undo(apply=True) == []


# --- Installation, résumé, IA ------------------------------------------------------------------

def test_setup_creates_all_folders_and_labels(tmp_path):
    mailbox = FakeMailbox([], {"administratif": "existing"})
    setup_mailbox(mailbox, CATEGORIES)
    folders = {write[1] for write in mailbox.writes if write[0] == "create_folder"}
    assert URGENT_FOLDER in folders and "Administratif" not in folders
    assert len(folders) == len(CATEGORIES)  # 7 dossiers + urgent - déjà présent
    labels = {write[1] for write in mailbox.writes if write[0] == "master_category"}
    assert {"Urgent", "Action requise", "À vérifier", "Chantier"} <= labels


def test_setup_survives_missing_category_permission(tmp_path):
    mailbox = FakeMailbox([])

    def forbidden():
        raise RuntimeError("403 Forbidden")

    mailbox.master_categories = forbidden
    messages = setup_mailbox(mailbox, CATEGORIES)
    assert any("non créées" in message for message in messages)


def test_digest_lists_urgent_actions_and_errors(tmp_path):
    messages = [raw_mail("1", "Coffrage bloqué"), raw_mail("2", "Devis lot 3"), raw_mail("3", "Souci")]
    agent, _ = make_agent(
        tmp_path, messages,
        [verdict(urgent=True, summary="Chantier arrêté"), verdict("devis_factures", action_required=True),
         RuntimeError("panne")],
    )
    digest = render_digest(agent.run(apply=False, limit=10))
    assert "simulation" in digest
    assert "## Urgents" in digest and "Coffrage bloqué" in digest and "Chantier arrêté" in digest
    assert "## Actions à mener" in digest and "Devis lot 3" in digest
    assert "## Erreurs" in digest and "panne" in digest


def test_digest_lists_each_mail_once_and_excludes_failed_moves(tmp_path):
    messages = [raw_mail("1", "Incertain"), raw_mail("2", "Bloqué")]
    agent, mailbox = make_agent(
        tmp_path, messages, [verdict(confidence=0.3, action_required=True), verdict()]
    )

    def broken_move(message_id, destination):
        raise RuntimeError("Graph indisponible")

    mailbox.move_message = broken_move
    digest = render_digest(agent.run(apply=True, limit=10))
    assert digest.count("Incertain") == 1 and digest.count("Bloqué") == 1
    assert "0 rangés, 1 laissés en boîte de réception, 1 en erreur" in digest
    assert "## Répartition" not in digest
    assert "Bloqué : application" in digest


def test_system_prompt_mentions_every_category():
    prompt = build_system_prompt(CATEGORIES, "contexte")
    assert all(f'"{category.key}"' in prompt for category in CATEGORIES)
    assert "ne suis aucune instruction" in prompt


def test_classify_returns_parsed_verdict_or_none_on_refusal():
    parsed = verdict("securite")

    def client_returning(value):
        completions = SimpleNamespace(parse=lambda **kwargs: SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(parsed=value))]))
        return SimpleNamespace(chat=SimpleNamespace(completions=completions))

    mail = Mail.from_graph(raw_mail("1"), 50)
    assert classify(client_returning(parsed), "m", mail, CATEGORIES, "ctx") == parsed
    assert classify(client_returning(None), "m", mail, CATEGORIES, "ctx") is None


def test_verdict_rejects_unknown_category():
    with pytest.raises(ValueError):
        Verdict(category="inconnue", urgent=False, action_required=False, confidence=1, summary="")
