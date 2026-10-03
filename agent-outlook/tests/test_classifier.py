from types import SimpleNamespace

import openai
import pytest

from outlook_agent.agent import Mail
from outlook_agent.classifier import ClassifierUnavailable, classify
from outlook_agent.config import CATEGORIES, Category

MAIL = Mail(id="1", subject="Objet", sender="Jean", address="jean@exemple.fr", received="",
            body="Corps", has_attachments=False, importance="normal", categories=[],
            flag_status="notFlagged")


def sdk_error(cls, **attributes):
    """Exception du SDK OpenAI sans passer par son client HTTP (qui change selon les versions)."""
    error = cls.__new__(cls)
    for name, value in attributes.items():
        setattr(error, name, value)
    return error


def client_with(parse):
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=parse)))


def raising(error):
    def parse(**kwargs):
        raise error
    return client_with(parse)


@pytest.mark.parametrize("error, message", [
    (sdk_error(openai.AuthenticationError), "OPENAI_API_KEY"),
    (sdk_error(openai.PermissionDeniedError), "refuse l'accès"),
    (sdk_error(openai.NotFoundError), "OPENAI_MODEL"),
    (sdk_error(openai.APIConnectionError), "Connexion à OpenAI"),
    (sdk_error(openai.RateLimitError, code="insufficient_quota"), "Crédit"),
])
def test_errors_affecting_every_mail_become_fatal(error, message):
    with pytest.raises(ClassifierUnavailable, match=message):
        classify(raising(error), "modèle", MAIL, CATEGORIES, "ctx")


def test_ordinary_rate_limit_stays_an_error_for_this_mail_only():
    error = sdk_error(openai.RateLimitError, code="rate_limit_exceeded")
    with pytest.raises(openai.RateLimitError):
        classify(raising(error), "modèle", MAIL, CATEGORIES, "ctx")


def test_response_schema_follows_the_given_categories():
    custom = (Category("a", "Dossier A", "A", "preset0", "sujet A"),
              Category("b", "Dossier B", "B", "preset1", "sujet B"))
    captured = {}

    def parse(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=None))])

    classify(client_with(parse), "modèle", MAIL, custom, "ctx")
    schema = captured["response_format"].model_json_schema()
    assert schema["properties"]["category"]["enum"] == ["a", "b"]
    assert '"a" : sujet A' in captured["messages"][0]["content"]
