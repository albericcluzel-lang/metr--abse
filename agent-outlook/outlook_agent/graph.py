"""Accès à Microsoft Graph pour la boîte Outlook : lecture, dossiers, catégories, déplacement."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterator
from urllib.parse import quote

import requests

GRAPH_URL = "https://graph.microsoft.com/v1.0"
# Sans le corps : il n'est téléchargé que pour les mails à analyser (get_body).
LIST_FIELDS = "id,subject,from,receivedDateTime,hasAttachments,importance,categories,flag"
PAGE_SIZE = 200  # liste légère (sans corps) : peu de requêtes même pour une grosse boîte
RETRY_STATUS = (429, 500, 502, 503, 504)
MAX_ATTEMPTS = 5

# Identifiants stables : un mail garde le même id quand il change de dossier (utile pour annuler).
PREFER_IDS = 'IdType="ImmutableId"'
PREFER_TEXT_BODY = PREFER_IDS + ', outlook.body-content-type="text"'


class GraphError(RuntimeError):
    """Réponse d'erreur de Microsoft Graph."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


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
        delay, last_error = 0.0, ""
        for attempt in range(MAX_ATTEMPTS):
            if attempt:
                time.sleep(delay)
            headers = {"Authorization": f"Bearer {self._token()}", "Prefer": prefer}
            try:
                response = self._session.request(
                    method, url, params=params, json=json, headers=headers, timeout=60
                )
            except (requests.ConnectionError, requests.Timeout) as exc:
                delay, last_error = float(2 ** attempt), f"réseau : {exc}"
                continue
            if response.status_code in RETRY_STATUS:
                delay, last_error = _retry_delay(response, attempt), f"statut {response.status_code}"
                continue
            if not response.ok:
                raise GraphError(
                    f"{method} {url} -> {response.status_code} {response.text[:300]}", response.status_code
                )
            return response.json() if response.content else {}
        raise GraphError(f"{method} {url} : trop de tentatives ({last_error})")

    def _pages(self, url: str, params: dict | None = None) -> Iterator[dict]:
        """Éléments d'une liste Graph, page par page, téléchargés au fur et à mesure."""
        while url:
            data = self._request("GET", url, params=params)
            yield from data.get("value", [])
            url, params = data.get("@odata.nextLink"), None

    # --- Messages ------------------------------------------------------------

    def iter_inbox_messages(self, since_days: int | None = None) -> Iterator[dict]:
        """Mails de la boîte de réception, du plus récent au plus ancien, sans leur corps."""
        params = {"$top": PAGE_SIZE, "$select": LIST_FIELDS, "$orderby": "receivedDateTime desc"}
        if since_days is not None:
            since = datetime.now(timezone.utc) - timedelta(days=since_days)
            params["$filter"] = f"receivedDateTime ge {since.strftime('%Y-%m-%dT%H:%M:%SZ')}"
        return self._pages(f"{GRAPH_URL}/me/mailFolders/inbox/messages", params)

    def get_body(self, message_id: str) -> str:
        """Corps du mail, en texte brut."""
        data = self._request(
            "GET", f"{GRAPH_URL}/me/messages/{quote(message_id, safe='')}",
            params={"$select": "body"}, prefer=PREFER_TEXT_BODY,
        )
        return (data.get("body") or {}).get("content") or ""

    def get_message(self, message_id: str) -> dict:
        """Catégories et drapeau actuels d'un mail."""
        return self._request(
            "GET", f"{GRAPH_URL}/me/messages/{quote(message_id, safe='')}",
            params={"$select": "categories,flag"},
        )

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
        folders = self._pages(
            f"{GRAPH_URL}/me/mailFolders/inbox/childFolders",
            {"$top": 100, "$select": "id,displayName"},
        )
        return {folder["displayName"].casefold(): folder["id"] for folder in folders}

    def create_folder(self, name: str) -> str:
        try:
            data = self._request(
                "POST", f"{GRAPH_URL}/me/mailFolders/inbox/childFolders", json={"displayName": name}
            )
        except GraphError as exc:
            # 409 : le dossier existe déjà, par exemple créé par une tentative dont la réponse s'est perdue.
            existing = self.child_folders().get(name.casefold()) if exc.status == 409 else None
            if existing is None:
                raise
            return existing
        return data["id"]

    # --- Catégories de couleur (permission MailboxSettings.ReadWrite) -----------

    def master_categories(self) -> set[str]:
        data = self._request("GET", f"{GRAPH_URL}/me/outlook/masterCategories")
        return {item["displayName"].casefold() for item in data.get("value", [])}

    def create_master_category(self, name: str, color: str) -> None:
        try:
            self._request(
                "POST", f"{GRAPH_URL}/me/outlook/masterCategories",
                json={"displayName": name, "color": color},
            )
        except GraphError as exc:
            if exc.status != 409:  # 409 : elle existe déjà
                raise
