"""Accès à Microsoft Graph pour la boîte Outlook : lecture, dossiers, catégories, déplacement."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Callable
from urllib.parse import quote

import requests

GRAPH_URL = "https://graph.microsoft.com/v1.0"
MESSAGE_FIELDS = "id,subject,from,receivedDateTime,body,hasAttachments,importance,categories,flag"
PAGE_SIZE = 25
RETRY_STATUS = (429, 503, 504)
MAX_ATTEMPTS = 5

# Identifiants stables : un mail garde le même id quand il change de dossier (utile pour annuler).
PREFER_IDS = 'IdType="ImmutableId"'
PREFER_TEXT_BODY = PREFER_IDS + ', outlook.body-content-type="text"'


class GraphError(RuntimeError):
    """Réponse d'erreur de Microsoft Graph."""


def _retry_delay(response: requests.Response, attempt: int) -> float:
    try:
        return min(float(response.headers["Retry-After"]), 60.0)
    except (KeyError, ValueError):
        return float(2 ** attempt)


class GraphClient:
    def __init__(self, token_provider: Callable[[], str]):
        self._token = token_provider
        self._session = requests.Session()

    def _request(self, method: str, url: str, *, params=None, json=None, prefer: str = PREFER_IDS) -> dict:
        for attempt in range(MAX_ATTEMPTS):
            headers = {"Authorization": f"Bearer {self._token()}", "Prefer": prefer}
            response = self._session.request(
                method, url, params=params, json=json, headers=headers, timeout=60
            )
            if response.status_code in RETRY_STATUS:
                time.sleep(_retry_delay(response, attempt))
                continue
            if not response.ok:
                raise GraphError(f"{method} {url} -> {response.status_code} {response.text[:300]}")
            return response.json() if response.content else {}
        raise GraphError(f"{method} {url} : trop de tentatives")

    def _collect(self, url: str, params: dict | None = None, limit: int | None = None) -> list[dict]:
        items: list[dict] = []
        prefer = PREFER_TEXT_BODY if params and "$select" in params and "body" in params["$select"] else PREFER_IDS
        while url and (limit is None or len(items) < limit):
            data = self._request("GET", url, params=params, prefer=prefer)
            items.extend(data.get("value", []))
            url, params = data.get("@odata.nextLink"), None
        return items if limit is None else items[:limit]

    # --- Messages ------------------------------------------------------------

    def list_inbox_messages(self, limit: int, since_days: int | None = None) -> list[dict]:
        params = {
            "$top": min(limit, PAGE_SIZE),
            "$select": MESSAGE_FIELDS,
            "$orderby": "receivedDateTime desc",
        }
        if since_days:
            since = datetime.now(timezone.utc) - timedelta(days=since_days)
            params["$filter"] = f"receivedDateTime ge {since.strftime('%Y-%m-%dT%H:%M:%SZ')}"
        return self._collect(f"{GRAPH_URL}/me/mailFolders/inbox/messages", params, limit)

    def update_message(self, message_id: str, categories: list[str] | None = None,
                       flag_status: str | None = None) -> None:
        payload: dict = {}
        if categories is not None:
            payload["categories"] = categories
        if flag_status is not None:
            payload["flag"] = {"flagStatus": flag_status}
        if payload:
            self._request("PATCH", f"{GRAPH_URL}/me/messages/{quote(message_id, safe='')}", json=payload)

    def move_message(self, message_id: str, destination: str) -> None:
        """`destination` : identifiant de dossier, ou nom connu comme « inbox »."""
        self._request(
            "POST",
            f"{GRAPH_URL}/me/messages/{quote(message_id, safe='')}/move",
            json={"destinationId": destination},
        )

    # --- Dossiers ------------------------------------------------------------

    def child_folders(self) -> dict[str, str]:
        """Sous-dossiers de la boîte de réception : {nom en minuscules: identifiant}."""
        folders = self._collect(
            f"{GRAPH_URL}/me/mailFolders/inbox/childFolders",
            {"$top": 100, "$select": "id,displayName"},
        )
        return {folder["displayName"].casefold(): folder["id"] for folder in folders}

    def create_folder(self, name: str) -> str:
        data = self._request(
            "POST", f"{GRAPH_URL}/me/mailFolders/inbox/childFolders", json={"displayName": name}
        )
        return data["id"]

    # --- Catégories de couleur (permission MailboxSettings.ReadWrite) -----------

    def master_categories(self) -> set[str]:
        data = self._request("GET", f"{GRAPH_URL}/me/outlook/masterCategories")
        return {item["displayName"].casefold() for item in data.get("value", [])}

    def create_master_category(self, name: str, color: str) -> None:
        self._request(
            "POST", f"{GRAPH_URL}/me/outlook/masterCategories",
            json={"displayName": name, "color": color},
        )
