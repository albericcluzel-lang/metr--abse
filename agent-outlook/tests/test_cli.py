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
