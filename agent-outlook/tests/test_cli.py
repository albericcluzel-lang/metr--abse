from dataclasses import replace

import pytest
import requests

from outlook_agent import __main__ as cli
from outlook_agent.config import ConfigError, Settings


@pytest.mark.parametrize("args", [
    ["run", "--since-days", "0"],
    ["run", "--since-days", "-1"],
    ["run", "--limit", "0"],
    ["run", "--min-confidence", "60"],
])
def test_rejects_invalid_options(args):
    with pytest.raises(SystemExit):
        cli.build_parser().parse_args(args)


def test_accepts_french_decimal_comma_for_confidence():
    assert cli.build_parser().parse_args(["run", "--min-confidence", "0,7"]).min_confidence == 0.7


@pytest.mark.parametrize("name, value", [("OUTLOOK_MIN_CONFIDENCE", "60"), ("OUTLOOK_BODY_CHARS", "0")])
def test_settings_reject_out_of_range_environment(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ConfigError):
        Settings.from_env()


def test_settings_accept_french_decimal_comma(monkeypatch):
    monkeypatch.setenv("OUTLOOK_MIN_CONFIDENCE", "0,7")
    assert Settings.from_env().min_confidence == 0.7


def test_settings_left_empty_in_env_file_use_defaults(monkeypatch):
    for name in ("OUTLOOK_SCOPES", "OPENAI_MODEL", "OUTLOOK_AGENT_HOME", "OUTLOOK_TENANT_ID"):
        monkeypatch.setenv(name, " ")
    settings = Settings.from_env()
    assert settings.scopes == ("Mail.ReadWrite",)
    assert settings.model == "gpt-4o-mini"
    assert settings.home.name == ".outlook_agent"
    assert settings.tenant_id == "organizations"


def test_provider_settings_are_read_from_env(monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.mistral.ai/v1")
    monkeypatch.setenv("OUTLOOK_LLM_PAUSE", "2,5")
    monkeypatch.setenv("OPENAI_MAX_RETRIES", "6")
    monkeypatch.setenv("OUTLOOK_JSON_MODE", "JSON")
    settings = Settings.from_env()
    assert (settings.llm_base_url, settings.llm_pause, settings.llm_max_retries, settings.json_mode) == \
        ("https://api.mistral.ai/v1", 2.5, 6, "json")


@pytest.mark.parametrize("name, value", [("OUTLOOK_JSON_MODE", "xml"), ("OUTLOOK_LLM_PAUSE", "-1")])
def test_invalid_provider_settings_are_reported(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ConfigError):
        Settings.from_env()


def test_client_points_to_the_configured_provider(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "clé-gratuite")
    settings = replace(Settings.from_env(), llm_base_url="https://api.mistral.ai/v1", llm_max_retries=6)
    client = cli._openai_client(settings)
    assert str(client.base_url).startswith("https://api.mistral.ai/v1") and client.max_retries == 6


def test_local_model_needs_no_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    local = replace(Settings.from_env(), llm_base_url="http://localhost:11434/v1")
    assert str(cli._openai_client(local).base_url).startswith("http://localhost:11434/v1")
    with pytest.raises(ConfigError, match="OPENAI_API_KEY"):
        cli._openai_client(replace(local, llm_base_url="https://api.mistral.ai/v1"))


def test_file_errors_are_reported_without_traceback(monkeypatch, capsys):
    def read_only(settings, args):
        raise PermissionError(13, "Permission refusée", "/x/state.json")

    monkeypatch.setitem(cli.COMMANDS, "setup", read_only)
    assert cli.main(["setup"]) == 1
    assert "Erreur de fichier" in capsys.readouterr().err


def test_network_errors_are_reported_without_traceback(monkeypatch, capsys):
    def offline(settings, args):
        raise requests.ConnectionError("hors ligne")

    monkeypatch.setitem(cli.COMMANDS, "setup", offline)
    assert cli.main(["setup"]) == 1
    assert "Erreur réseau" in capsys.readouterr().err
