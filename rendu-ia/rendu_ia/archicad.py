"""Export automatique des vues depuis Archicad, sans y toucher : le programme demande à Archicad, ouvert
sur le même PC, de publier un jeu de publication (les vues 3D enregistrées en images).

Archicad répond sur le PC par son interface JSON (ports 19723 et suivants). La publication elle-même est
une commande de l'extension gratuite Tapir (« PublishPublisherSet »), à installer une fois dans Archicad :
https://github.com/ENZYME-APD/tapir-archicad-automation
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from .config import ConfigError

PORTS = range(19723, 19744)      # un port par Archicad ouvert, le premier d'abord
PUBLISH_TIMEOUT = 3600           # un PhotoRendu par vue peut prendre plusieurs minutes
_direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # Archicad est sur ce PC : pas de proxy


def call(port: int, command: str, parameters: dict | None = None, timeout: float = 10) -> dict:
    """Envoie une commande à Archicad et rend son résultat."""
    body = json.dumps({"command": command, "parameters": parameters or {}}).encode("utf-8")
    request = urllib.request.Request(f"http://127.0.0.1:{port}", body, {"Content-Type": "application/json"})
    with _direct.open(request, timeout=timeout) as response:
        answer = json.loads(response.read().decode("utf-8"))
    if not answer.get("succeeded"):
        raise ConfigError(f"Archicad a refusé la commande {command} : "
                          f"{(answer.get('error') or {}).get('message', 'raison inconnue')}")
    return answer.get("result") or {}


def find_port() -> int:
    for port in PORTS:
        try:
            if call(port, "API.IsAlive", timeout=2).get("isAlive"):
                return port
        except (OSError, ValueError, ConfigError):
            continue
    raise ConfigError("Archicad ne répond pas : ouvrez le projet dans Archicad sur ce PC, puis relancez.")


def publish(set_name: str, folder: Path) -> None:
    """Fait publier le jeu `set_name` par Archicad dans `folder`."""
    port = find_port()
    try:
        names = call(port, "API.GetPublisherSetNames").get("publisherSetNames") or []
    except (OSError, ValueError) as exc:
        raise ConfigError(f"Archicad n'a pas donné ses jeux de publication : {exc}") from exc
    if set_name not in names:
        raise ConfigError(f"Jeu de publication « {set_name} » introuvable dans Archicad "
                          f"(jeux du projet : {', '.join(names) or 'aucun'}).")
    folder.mkdir(parents=True, exist_ok=True)
    try:
        result = call(port, "API.ExecuteAddOnCommand", {
            "addOnCommandId": {"commandNamespace": "TapirCommand", "commandName": "PublishPublisherSet"},
            "addOnCommandParameters": {"publisherSetName": set_name, "outputPath": str(folder)},
        }, timeout=PUBLISH_TIMEOUT)
    except ConfigError as exc:
        raise ConfigError(f"{exc} Vérifiez que l'extension gratuite Tapir est installée dans Archicad "
                          "(voir le README, « Tout automatiser »).") from exc
    except (OSError, ValueError) as exc:
        raise ConfigError(f"Archicad n'a pas terminé la publication : {exc}") from exc
    response = result.get("addOnCommandResponse") or {}
    outcome = response.get("executionResult") or response
    if outcome.get("success") is False:
        raise ConfigError(f"Archicad n'a pas pu publier « {set_name} » : "
                          f"{(outcome.get('error') or {}).get('message', 'raison inconnue')}")
