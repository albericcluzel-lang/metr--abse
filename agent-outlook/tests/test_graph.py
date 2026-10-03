import pytest
import requests

from outlook_agent import graph
from outlook_agent.config import FatalError
from outlook_agent.graph import GraphClient, GraphError


class FakeResponse:
    def __init__(self, status=200, payload=None, headers=None):
        self.status_code = status
        self.ok = status < 400
        self._payload = payload
        self.headers = headers or {}
        self.content = b"x" if payload is not None else b""
        self.text = str(payload)

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, params=None, json=None, headers=None, timeout=None):
        self.calls.append({"method": method, "url": url, "params": params, "json": json, "headers": headers})
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def make_client(responses):
    client = GraphClient(lambda: "jeton")
    client._session = FakeSession(responses)
    return client, client._session


@pytest.fixture(autouse=True)
def sleeps(monkeypatch):
    recorded = []
    monkeypatch.setattr(graph.time, "sleep", recorded.append)
    return recorded


def test_inbox_listing_is_lazy_and_follows_pagination():
    client, session = make_client([
        FakeResponse(payload={"value": [{"id": "1"}, {"id": "2"}], "@odata.nextLink": "https://next"}),
        FakeResponse(payload={"value": [{"id": "3"}, {"id": "4"}]}),
    ])
    messages = client.iter_inbox_messages()
    assert [next(messages)["id"], next(messages)["id"]] == ["1", "2"]
    assert len(session.calls) == 1  # la page suivante n'est demandée qu'au besoin
    assert [m["id"] for m in messages] == ["3", "4"]
    first, second = session.calls
    assert first["url"].endswith("/me/mailFolders/inbox/messages")
    assert first["params"]["$orderby"] == "receivedDateTime desc"
    assert second["url"] == "https://next" and second["params"] is None


def test_inbox_listing_uses_stable_ids_and_does_not_download_bodies():
    client, session = make_client([FakeResponse(payload={"value": []})])
    list(client.iter_inbox_messages(since_days=2))
    call = session.calls[0]
    assert call["headers"]["Authorization"] == "Bearer jeton"
    assert call["headers"]["Prefer"] == 'IdType="ImmutableId"'
    assert "body" not in call["params"]["$select"].split(",")
    assert call["params"]["$filter"].startswith("receivedDateTime ge ")


def test_get_body_asks_for_plain_text():
    client, session = make_client([FakeResponse(payload={"body": {"content": "Bonjour"}})])
    assert client.get_body("1") == "Bonjour"
    call = session.calls[0]
    assert call["params"] == {"$select": "body"}
    assert 'outlook.body-content-type="text"' in call["headers"]["Prefer"]


def test_move_message_quotes_the_id_and_sends_destination():
    client, session = make_client([FakeResponse(payload={})])
    client.move_message("AAMk/id=+x", "dossier-1")
    call = session.calls[0]
    assert call["method"] == "POST"
    assert call["url"].endswith("/me/messages/AAMk%2Fid%3D%2Bx/move")
    assert call["json"] == {"destinationId": "dossier-1"}


def test_update_message_sends_only_what_is_given_and_skips_empty_updates():
    client, session = make_client([FakeResponse(payload={})])
    client.update_message("1", categories=["A"], flag_status="flagged")
    client.update_message("1")
    assert len(session.calls) == 1
    assert session.calls[0]["json"] == {"categories": ["A"], "flag": {"flagStatus": "flagged"}}


def test_child_folders_maps_lowercase_names_to_ids():
    client, _ = make_client([FakeResponse(payload={"value": [{"id": "9", "displayName": "À traiter URGENT"}]})])
    assert client.child_folders() == {"à traiter urgent": "9"}


def test_get_message_reads_only_categories_flag_and_folder():
    client, session = make_client([FakeResponse(payload={"categories": ["A"], "flag": {}})])
    assert client.get_message("1")["categories"] == ["A"]
    assert session.calls[0]["params"] == {"$select": "categories,flag,parentFolderId"}


def test_folder_name():
    client, session = make_client([FakeResponse(payload={"displayName": "Éléments supprimés"})])
    assert client.folder_name("AB/C=") == "Éléments supprimés"
    assert session.calls[0]["url"].endswith("/me/mailFolders/AB%2FC%3D")


def test_network_error_while_renewing_the_token_is_retried():
    attempts = []

    def token():
        attempts.append(1)
        if len(attempts) == 1:
            raise requests.ConnectionError("login.microsoftonline.com injoignable")
        return "jeton"

    client = GraphClient(token)
    client._session = FakeSession([FakeResponse(payload={"id": "ok"})])
    assert client.create_folder("Test") == "ok"
    assert len(attempts) == 2


def test_retries_on_throttling_then_succeeds(sleeps):
    client, session = make_client([
        FakeResponse(429, payload={}, headers={"Retry-After": "3"}),
        FakeResponse(payload={"id": "nouveau"}),
    ])
    assert client.create_folder("Test") == "nouveau"
    assert len(session.calls) == 2
    assert sleeps == [3.0]


@pytest.mark.parametrize("failure", [
    FakeResponse(502, payload={}),
    FakeResponse(500, payload={}),
    requests.ConnectionError("connexion coupée"),
    requests.Timeout("délai dépassé"),
])
def test_retries_server_and_network_errors(failure):
    client, session = make_client([failure, FakeResponse(payload={"id": "ok"})])
    assert client.create_folder("Test") == "ok"
    assert len(session.calls) == 2


@pytest.mark.parametrize("failure, fatal", [
    (requests.ConnectionError("réseau coupé"), True),   # panne générale : inutile d'insister
    (FakeResponse(429, payload={}), True),              # boîte saturée : idem
    (FakeResponse(503, payload={}), False),             # peut venir d'un seul mail abîmé
])
def test_gives_up_after_too_many_attempts_without_a_useless_last_wait(sleeps, failure, fatal):
    client, session = make_client([failure] * graph.MAX_ATTEMPTS)
    with pytest.raises(GraphError, match="indisponible") as error:
        client.create_folder("Test")
    assert isinstance(error.value, FatalError) == fatal
    assert len(session.calls) == graph.MAX_ATTEMPTS
    assert len(sleeps) == graph.MAX_ATTEMPTS - 1


def test_refused_connection_stops_the_run():
    client, _ = make_client([FakeResponse(401, payload={"error": "InvalidAuthenticationToken"})])
    with pytest.raises(FatalError, match="401") as error:
        client.master_categories()
    assert isinstance(error.value, GraphError) and error.value.status == 401


def test_forbidden_on_one_mail_is_not_fatal():
    # Ex. : mail protégé. Un seul mail ne doit pas bloquer tous les passages.
    client, _ = make_client([FakeResponse(403, payload={"error": "ErrorAccessDenied"})])
    with pytest.raises(GraphError) as error:
        client.get_body("protégé")
    assert not isinstance(error.value, FatalError) and error.value.status == 403


def test_error_specific_to_one_mail_is_not_fatal():
    client, _ = make_client([FakeResponse(404, payload={"error": "ErrorItemNotFound"})])
    with pytest.raises(GraphError) as error:
        client.get_body("supprimé")
    assert not isinstance(error.value, FatalError) and error.value.status == 404


def test_create_folder_that_already_exists_returns_the_existing_one():
    # Ex. : la première tentative a créé le dossier mais sa réponse s'est perdue.
    client, _ = make_client([
        FakeResponse(409, payload={"error": "ErrorFolderExists"}),
        FakeResponse(payload={"value": [{"id": "existant", "displayName": "Devis et factures"}]}),
    ])
    assert client.create_folder("Devis et factures") == "existant"


def test_create_folder_conflict_without_a_matching_folder_still_fails():
    client, _ = make_client([
        FakeResponse(409, payload={"error": "conflit"}),
        FakeResponse(payload={"value": []}),
    ])
    with pytest.raises(GraphError):
        client.create_folder("Devis et factures")


def test_create_master_category_ignores_already_existing():
    client, _ = make_client([FakeResponse(409, payload={"error": "exists"})])
    client.create_master_category("Urgent", "preset0")
    client, _ = make_client([FakeResponse(403, payload={"error": "Forbidden"})])
    with pytest.raises(GraphError):
        client.create_master_category("Urgent", "preset0")
