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


def test_local_model_gets_safe_defaults_and_cloud_providers_their_own(monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost:11434/v1")
    local = Settings.from_env()
    assert (local.llm_temperature, local.llm_max_tokens, local.llm_reasoning_effort) == (0.0, 512, None)

    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("OUTLOOK_LLM_MAX_TOKENS", "1024")
    monkeypatch.setenv("OUTLOOK_LLM_REASONING_EFFORT", "low")
    groq = Settings.from_env()
    assert (groq.llm_temperature, groq.llm_max_tokens, groq.llm_reasoning_effort) == (None, 1024, "low")
    assert cli._request_options(groq) == {"max_tokens": 1024, "reasoning_effort": "low"}

    monkeypatch.setenv("OPENAI_BASE_URL", "http://127.0.0.1:11434/v1")
    monkeypatch.setenv("OUTLOOK_LLM_TEMPERATURE", "none")
    assert Settings.from_env().llm_temperature is None


def test_reasoning_effort_none_is_really_sent(monkeypatch):
    # « none » est une vraie valeur (Mistral Small, OpenAI, Ollama) : elle doit partir telle quelle.
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.mistral.ai/v1")
    monkeypatch.setenv("OUTLOOK_LLM_REASONING_EFFORT", "none")
    assert cli._request_options(Settings.from_env()) == {"reasoning_effort": "none"}
    monkeypatch.setenv("OUTLOOK_LLM_REASONING_EFFORT", "")
    assert cli._request_options(Settings.from_env()) == {}


def test_local_model_is_never_reached_through_a_proxy(monkeypatch):
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class LocalModel(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            body = json.dumps({"id": "x", "object": "chat.completion", "created": 0, "model": "m",
                               "choices": [{"index": 0, "finish_reason": "stop",
                                            "message": {"role": "assistant", "content": "ok"}}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), LocalModel)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        # Proxy d'entreprise configuré (ici injoignable) : un modèle local ne doit jamais passer par lui,
        # sinon le contenu des mails lui serait envoyé.
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            monkeypatch.setenv(name, "http://127.0.0.1:9")
        for name in ("NO_PROXY", "no_proxy"):
            monkeypatch.delenv(name, raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        settings = replace(Settings.from_env(), llm_base_url=f"http://127.0.0.1:{server.server_port}/v1",
                           llm_max_retries=0)
        reply = cli._openai_client(settings).chat.completions.create(model="m", messages=[])
        assert reply.choices[0].message.content == "ok"
    finally:
        server.shutdown()
