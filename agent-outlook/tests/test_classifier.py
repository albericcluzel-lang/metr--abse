from types import SimpleNamespace

import openai
import pytest

from outlook_agent.agent import Mail
from outlook_agent.classifier import Classifier, ClassifierUnavailable, _json_object, classify
from outlook_agent.config import CATEGORIES, Category

MAIL = Mail(id="1", subject="Objet", sender="Jean", address="jean@exemple.fr", received="",
            body="Corps", has_attachments=False, importance="normal")

VALID_JSON = '{"category": "chantier", "urgent": false, "action_required": true, "confidence": 0.8, "summary": "OK"}'


def sdk_error(cls, **attributes):
    """Exception du SDK OpenAI sans passer par son client HTTP (qui change selon les versions)."""
    error = cls.__new__(cls)
    for name, value in attributes.items():
        setattr(error, name, value)
    return error


def completion(parsed=None, content=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=parsed, content=content))])


class FakeClient:
    """Fournisseur compatible OpenAI simulé : `parse` (schéma strict) et `create` (JSON ou texte)."""

    def __init__(self, parse=None, create=None):
        self.calls = []

        def record(kind, handler):
            def call(**kwargs):
                self.calls.append((kind, kwargs))
                result = handler(**kwargs)
                if isinstance(result, BaseException):
                    raise result
                return result
            return call

        self.chat = SimpleNamespace(completions=SimpleNamespace(
            parse=record("parse", parse or (lambda **kw: completion())),
            create=record("create", create or (lambda **kw: completion(content=VALID_JSON))),
        ))


def raising(error):
    return FakeClient(parse=lambda **kwargs: error)


@pytest.mark.parametrize("error, message", [
    (sdk_error(openai.AuthenticationError), "OPENAI_API_KEY"),
    (sdk_error(openai.PermissionDeniedError), "refuse l'accès"),
    (sdk_error(openai.NotFoundError), "OPENAI_MODEL"),
    (sdk_error(openai.APIConnectionError), "Connexion au fournisseur"),
    (sdk_error(openai.RateLimitError, code="insufficient_quota"), "quota épuisé"),
    # Après les nouvelles tentatives du SDK : limite d'une offre gratuite, on reprendra au passage suivant.
    (sdk_error(openai.RateLimitError, code="rate_limit_exceeded"), "Limite de requêtes"),
])
def test_errors_affecting_every_mail_stop_the_run(error, message):
    with pytest.raises(ClassifierUnavailable, match=message):
        classify(raising(error), "modèle", MAIL, CATEGORIES, "ctx")


def test_slow_request_stays_an_error_for_this_mail_only():
    error = sdk_error(openai.APITimeoutError)  # sous-classe d'APIConnectionError
    with pytest.raises(openai.APITimeoutError) as raised:
        classify(raising(error), "modèle", MAIL, CATEGORIES, "ctx")
    assert not isinstance(raised.value, ClassifierUnavailable)


def test_response_schema_follows_the_given_categories():
    custom = (Category("a", "Dossier A", "A", "preset0", "sujet A"),
              Category("b", "Dossier B", "B", "preset1", "sujet B"))
    client = FakeClient()
    classify(client, "modèle", MAIL, custom, "ctx")
    kind, kwargs = client.calls[0]
    assert kind == "parse"
    assert kwargs["response_format"].model_json_schema()["properties"]["category"]["enum"] == ["a", "b"]
    assert '"a" : sujet A' in kwargs["messages"][0]["content"]


def test_strict_schema_is_used_first():
    client = FakeClient(parse=lambda **kw: completion(parsed="verdict"))
    assert Classifier(client, "m", CATEGORIES, "ctx")(MAIL) == "verdict"
    assert [kind for kind, _ in client.calls] == ["parse"]


def test_falls_back_to_json_mode_when_the_provider_rejects_the_schema_and_remembers_it():
    rejected = sdk_error(openai.BadRequestError, message="response_format json_schema is not supported")
    client = FakeClient(parse=lambda **kw: rejected)
    classifier = Classifier(client, "m", CATEGORIES, "ctx")

    verdict = classifier(MAIL)
    assert verdict.category == "chantier" and verdict.action_required
    assert classifier.mode == "json"
    kind, kwargs = client.calls[-1]
    assert kind == "create" and kwargs["response_format"] == {"type": "json_object"}
    assert "UNIQUEMENT par un objet JSON" in kwargs["messages"][0]["content"]

    classifier(MAIL)  # mail suivant : directement en mode JSON, sans retenter le schéma
    assert [kind for kind, _ in client.calls] == ["parse", "create", "create"]


def test_falls_back_to_plain_text_when_json_mode_is_rejected_too():
    rejected = sdk_error(openai.BadRequestError, message="unknown field: response_format")

    def create(**kwargs):
        return rejected if "response_format" in kwargs else completion(content=f"```json\n{VALID_JSON}\n```")

    classifier = Classifier(FakeClient(parse=lambda **kw: rejected, create=create), "m", CATEGORIES, "ctx")
    assert classifier(MAIL).category == "chantier"
    assert classifier.mode == "text"


def test_other_bad_requests_are_not_mistaken_for_a_format_problem():
    too_long = sdk_error(openai.BadRequestError, message="context length exceeded")
    classifier = Classifier(FakeClient(parse=lambda **kw: too_long), "m", CATEGORIES, "ctx")
    with pytest.raises(openai.BadRequestError):
        classifier(MAIL)
    assert classifier.mode == "schema"


def test_forced_mode_never_falls_back():
    rejected = sdk_error(openai.BadRequestError, message="response_format not supported")
    classifier = Classifier(FakeClient(create=lambda **kw: rejected), "m", CATEGORIES, "ctx", json_mode="json")
    with pytest.raises(openai.BadRequestError):
        classifier(MAIL)


def test_json_answer_outside_the_allowed_categories_is_rejected():
    bad = VALID_JSON.replace("chantier", "piscine")
    classifier = Classifier(FakeClient(create=lambda **kw: completion(content=bad)), "m", CATEGORIES, "ctx",
                            json_mode="json")
    with pytest.raises(ValueError):
        classifier(MAIL)


def test_empty_answer_counts_as_a_refusal():
    classifier = Classifier(FakeClient(create=lambda **kw: completion(content="")), "m", CATEGORIES, "ctx",
                            json_mode="text")
    assert classifier(MAIL) is None


def test_calls_are_spaced_by_the_configured_pause():
    now, waits = [100.0], []

    def sleep(seconds):
        waits.append(round(seconds, 3))
        now[0] += seconds

    classifier = Classifier(FakeClient(), "m", CATEGORIES, "ctx", pause=4.0, clock=lambda: now[0], sleep=sleep)
    classifier(MAIL)          # premier appel : pas d'attente
    now[0] += 1.5             # le mail suivant arrive 1,5 s plus tard
    classifier(MAIL)
    assert waits == [2.5]


def test_json_object_is_extracted_from_wrapped_answers():
    assert _json_object('Voici :\n```json\n{"a": 1}\n```') == '{"a": 1}'
    assert _json_object("pas de json") == "pas de json"


def test_provider_options_are_sent_in_every_mode():
    options = {"temperature": 0, "max_tokens": 512, "reasoning_effort": "none"}
    rejected = sdk_error(openai.BadRequestError, message="json_schema not supported")
    client = FakeClient(parse=lambda **kw: rejected)
    Classifier(client, "m", CATEGORIES, "ctx", options=options)(MAIL)
    for _, kwargs in client.calls:  # schéma refusé, puis repli en mode JSON
        assert {key: kwargs[key] for key in options} == options


def test_tokens_per_minute_limit_of_groq_stops_the_run():
    error = sdk_error(openai.APIStatusError, status_code=413, message="Request too large: tokens per minute")
    with pytest.raises(ClassifierUnavailable, match="jetons par minute"):
        classify(raising(error), "m", MAIL, CATEGORIES, "ctx")


def test_rate_limit_is_not_swallowed_by_the_generic_status_branch():
    error = sdk_error(openai.RateLimitError, status_code=429, code="rate_limit_exceeded")
    with pytest.raises(ClassifierUnavailable, match="Limite de requêtes"):
        classify(raising(error), "m", MAIL, CATEGORIES, "ctx")


def test_other_server_errors_stay_errors_for_this_mail():
    error = sdk_error(openai.InternalServerError, status_code=500, message="oops")
    with pytest.raises(openai.InternalServerError):
        classify(raising(error), "m", MAIL, CATEGORIES, "ctx")
