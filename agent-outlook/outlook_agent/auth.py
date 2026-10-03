"""Connexion à Microsoft 365 (flux « code d'appareil ») avec jeton conservé localement."""
from __future__ import annotations

import os

import msal

from .config import ConfigError, FatalError, Settings


class AuthError(FatalError):
    """Connexion Microsoft impossible ou à refaire."""


class TokenProvider:
    def __init__(self, settings: Settings):
        if not settings.client_id:
            raise ConfigError("OUTLOOK_CLIENT_ID manquant : voir le README, étape 2.")
        self._path = settings.home / "token_cache.json"
        self._scopes = list(settings.scopes)
        self._cache = msal.SerializableTokenCache()
        if self._path.exists():
            self._cache.deserialize(self._path.read_text(encoding="utf-8"))
        self._app = msal.PublicClientApplication(
            settings.client_id,
            authority=f"https://login.microsoftonline.com/{settings.tenant_id}",
            token_cache=self._cache,
        )

    def token(self, interactive: bool = False) -> str:
        """Jeton valide. Sans `interactive`, ne demande jamais de se reconnecter à la main."""
        result = None
        accounts = self._app.get_accounts()
        if accounts:
            result = self._app.acquire_token_silent(self._scopes, account=accounts[0])
        if not result:
            if not interactive:
                raise AuthError(
                    "Connexion Microsoft requise : lancez `python -m outlook_agent login`."
                )
            flow = self._app.initiate_device_flow(scopes=self._scopes)
            if "user_code" not in flow:
                raise AuthError(f"Impossible de démarrer la connexion : {flow.get('error_description', flow)}")
            print(flow["message"], flush=True)
            result = self._app.acquire_token_by_device_flow(flow)
        if "access_token" not in result:
            raise AuthError(result.get("error_description") or str(result))
        self._save()
        return result["access_token"]

    def _save(self) -> None:
        if not self._cache.has_state_changed:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(self._path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(self._cache.serialize())
