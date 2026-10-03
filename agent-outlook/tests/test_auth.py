import stat
import sys
from dataclasses import replace

import pytest

from outlook_agent import auth
from outlook_agent.auth import AuthError, TokenProvider
from outlook_agent.config import Settings


class FakeApp:
    """Remplace msal.PublicClientApplication : aucun appel réseau."""

    def __init__(self, client_id, authority, token_cache):
        self.cache = token_cache

    def get_accounts(self):
        return []


@pytest.fixture
def settings(tmp_path, monkeypatch):
    monkeypatch.setattr(auth.msal, "PublicClientApplication", FakeApp)
    return Settings(client_id="client", tenant_id="tenant", scopes=("Mail.ReadWrite",), model="m",
                    home=tmp_path, body_chars=50, min_confidence=0.6, user_context="")


def test_corrupted_token_cache_does_not_block_login(settings):
    (settings.home / "token_cache.json").write_text('{"AccessToken": {', encoding="utf-8")
    provider = TokenProvider(settings)  # ne plante pas : il faudra simplement se reconnecter
    with pytest.raises(AuthError, match="login"):
        provider.token()


def test_token_cache_is_written_atomically_and_privately(settings):
    provider = TokenProvider(settings)
    provider._cache.has_state_changed = True
    provider._save()
    path = settings.home / "token_cache.json"
    assert path.exists() and not list(settings.home.glob("*.tmp"))
    if sys.platform != "win32":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_missing_client_id_is_reported(settings):
    from outlook_agent.config import ConfigError

    with pytest.raises(ConfigError):
        TokenProvider(replace(settings, client_id=""))
