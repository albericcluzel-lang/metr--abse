import pytest
import requests

from outlook_agent import graph
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


def test_list_inbox_follows_pagination_and_respects_limit():
    client, session = make_client([
        FakeResponse(payload={"value": [{"id": "1"}, {"id": "2"}], "@odata.nextLink": "https://next"}),
        FakeResponse(payload={"value": [{"id": "3"}, {"id": "4"}]}),
    ])
    messages = client.list_inbox_messages(limit=3)
    assert [m["id"] for m in messages] == ["1", "2", "3"]
    first, second = session.calls
    assert first["url"].endswith("/me/mailFolders/inbox/messages")
    assert first["params"]["$orderby"] == "receivedDateTime desc"
    assert second["url"] == "https://next" and second["params"] is None


def test_list_inbox_asks_for_stable_ids_text_body_and_bearer_token():
    client, session = make_client([FakeResponse(payload={"value": []})])
    client.list_inbox_messages(limit=5, since_days=2)
    call = session.calls[0]
    assert call["headers"]["Authorization"] == "Bearer jeton"
    assert 'IdType="ImmutableId"' in call["headers"]["Prefer"]
    assert 'outlook.body-content-type="text"' in call["headers"]["Prefer"]
    assert call["params"]["$filter"].startswith("receivedDateTime ge ")


def test_other_calls_do_not_request_text_body():
    client, session = make_client([FakeResponse(payload={"value": []})])
    client.child_folders()
    assert "body-content-type" not in session.calls[0]["headers"]["Prefer"]


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


def test_get_message_reads_only_categories_and_flag():
    client, session = make_client([FakeResponse(payload={"categories": ["A"], "flag": {}})])
    assert client.get_message("1")["categories"] == ["A"]
    assert session.calls[0]["params"] == {"$select": "categories,flag"}


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


def test_gives_up_after_too_many_attempts_without_a_useless_last_wait(sleeps):
    client, session = make_client([FakeResponse(503, payload={})] * graph.MAX_ATTEMPTS)
    with pytest.raises(GraphError, match="trop de tentatives"):
        client.create_folder("Test")
    assert len(session.calls) == graph.MAX_ATTEMPTS
    assert len(sleeps) == graph.MAX_ATTEMPTS - 1


def test_error_status_raises_with_details():
    client, _ = make_client([FakeResponse(403, payload={"error": "Forbidden"})])
    with pytest.raises(GraphError, match="403"):
        client.master_categories()
