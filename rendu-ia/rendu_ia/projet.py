"""Dossier d'un projet : captures Archicad, références, ambiance et images produites."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path

from .config import ConfigError

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")
VIDEO_SUFFIXES = (".mp4", ".mov", ".webm")
MAX_REFERENCES = 12   # le modèle d'image accepte 14 images : capture + image maître + 12 références

BRIEF_TEMPLATE = """\
# Ambiance voulue pour le projet, en quelques lignes (les lignes qui commencent par # sont ignorées).
# Ce texte passe avant les réglages par défaut (soleil de fin d'après-midi, chêne, murs grège).
# Exemple :
# Appartement familial lumineux, esprit années 60 revisité. Parquet chêne en point de Hongrie,
# murs blanc cassé, touches de jaune moutarde et de terracotta. Lumière douce de fin d'après-midi.
"""


@dataclass(frozen=True)
class Project:
    root: Path

    @classmethod
    def open(cls, path: str | Path) -> "Project":
        root = Path(path).expanduser().resolve()
        if not (root / "captures").is_dir():
            raise ConfigError(f"{root} n'est pas un dossier de projet : il lui manque le sous-dossier "
                              "« captures ». Pour en créer un : python -m rendu_ia nouveau <dossier>")
        return cls(root)

    @classmethod
    def create(cls, path: str | Path) -> "Project":
        root = Path(path).expanduser().resolve()
        (root / "captures").mkdir(parents=True, exist_ok=True)
        (root / "references").mkdir(exist_ok=True)
        brief = root / "ambiance.txt"
        if not brief.exists():
            brief.write_text(BRIEF_TEMPLATE, encoding="utf-8")
        return cls(root)

    @property
    def output(self) -> Path:
        return self.root / "sorties"

    def captures(self) -> list[Path]:
        return _images(self.root / "captures")

    def references(self) -> list[Path]:
        return _images(self.root / "references")

    def brief(self) -> str | None:
        path = self.root / "ambiance.txt"
        if not path.is_file():
            return None
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#")]
        return "\n".join(lines).strip() or None

    def master(self) -> Path | None:
        return find_output(self.output / "maitre", IMAGE_SUFFIXES)

    def find_capture(self, name: str) -> Path:
        wanted = name.lower()
        for capture in self.captures():
            if wanted in (capture.name.lower(), capture.stem.lower()):
                return capture
        available = ", ".join(capture.name for capture in self.captures()) or "aucune"
        raise ConfigError(f"Capture « {name} » introuvable dans {self.root / 'captures'} (disponibles : {available}).")


def reference_label(path: Path) -> str:
    """Le nom du fichier dit à quoi sert la référence : « sol - parquet chene point de hongrie.jpg »."""
    return " ".join(path.stem.replace("_", " ").split())


def find_output(base: Path, suffixes: tuple[str, ...]) -> Path | None:
    """Fichier déjà produit pour `base` (chemin sans extension), quelle que soit son extension."""
    for suffix in suffixes:
        candidate = base.with_name(base.name + suffix)
        if candidate.is_file():
            return candidate
    return None


def write_atomic(path: Path, data: bytes) -> None:
    """Écrit d'abord un fichier temporaire puis le renomme : une coupure ne laisse jamais un fichier
    à moitié écrit, qui serait pris pour un résultat terminé et jamais refait."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(data)
    for attempt in range(5):
        try:
            os.replace(temporary, path)
            return
        except PermissionError:
            # Sous Windows, un antivirus ou l'aperçu de l'explorateur tient parfois le fichier un instant.
            if attempt == 4:
                temporary.unlink(missing_ok=True)
                raise
            time.sleep(0.2)


def _images(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted((path for path in folder.iterdir()
                   if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES),
                  key=lambda path: path.name.lower())
