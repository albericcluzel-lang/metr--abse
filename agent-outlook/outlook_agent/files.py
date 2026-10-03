"""Écriture de fichiers sans risque de les laisser à moitié écrits."""
from __future__ import annotations

import os
import time
from pathlib import Path

REPLACE_ATTEMPTS = 5


def write_atomic(path: Path, text: str, *, private: bool = False) -> None:
    """Écrit d'abord un fichier temporaire puis le renomme : un arrêt brutal (coupure, tâche
    interrompue) laisse l'ancien fichier intact au lieu d'un fichier tronqué.

    `private` : lisible par l'utilisateur seul (jeton de connexion).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if private else 0o666)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())  # sur le disque avant le renommage, même en cas de coupure
    for attempt in range(REPLACE_ATTEMPTS):
        try:
            os.replace(temporary, path)
            return
        except PermissionError:
            # Sous Windows, un antivirus ou l'indexation tient parfois le fichier un instant.
            if attempt == REPLACE_ATTEMPTS - 1:
                temporary.unlink(missing_ok=True)
                raise
            time.sleep(0.2)
