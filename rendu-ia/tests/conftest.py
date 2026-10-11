import threading
from pathlib import Path

import pytest
from PIL import Image

from rendu_ia.projet import Project, write_atomic

ENV_NAMES = ("GEMINI_API_KEY", "GOOGLE_API_KEY", "RENDU_FOURNISSEUR", "RENDU_GEMINI_MODELE_IMAGE",
             "RENDU_GEMINI_MODELE_TEXTE", "FAL_KEY", "RENDU_MODELE_IMAGE", "RENDU_RESOLUTION", "RENDU_FORMAT", "RENDU_MODELE_LLM",
             "RENDU_MODELE_UPSCALE", "RENDU_FACTEUR_UPSCALE", "RENDU_MODELE_VIDEO", "RENDU_ENDPOINT_VIDEO",
             "RENDU_DUREE_VIDEO", "RENDU_PARALLELE", "RENDU_OPTIONS_IMAGE", "RENDU_OPTIONS_UPSCALE",
             "RENDU_OPTIONS_VIDEO")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Aucun réglage du poste ni du fichier .env ne doit influencer les tests."""
    for name in ENV_NAMES:
        monkeypatch.setenv(name, "")
    monkeypatch.setattr("rendu_ia.config.load_dotenv", lambda *args, **kwargs: None)


def make_image(path: Path, size=(90, 160), color="grey", mode="RGB") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new(mode, size, color).save(path)
    return path


@pytest.fixture
def project(tmp_path) -> Project:
    project = Project.create(tmp_path / "appart")
    make_image(project.root / "captures" / "salon.png")
    make_image(project.root / "captures" / "cuisine.jpg")
    make_image(project.root / "references" / "sol - parquet chene point de hongrie.jpg", color="brown")
    (project.root / "captures" / "notes.txt").write_text("pas une image", encoding="utf-8")
    return project


class FakeFal:
    """Remplace fal.ai : note les demandes et produit des fichiers factices."""

    def __init__(self, key: str = "test", storyboard: str | None = None, fail: dict | None = None):
        self.calls: list[tuple[str, dict]] = []
        self.uploads: list[Path] = []
        self.storyboard = storyboard
        self.fail = fail or {}   # endpoint -> exception à lever
        self.closed = False
        self._lock = threading.Lock()

    def upload(self, path: Path, *, max_side=2048) -> str:
        with self._lock:
            self.uploads.append(path)
        return f"https://cdn.test/{path.name}"

    def run(self, endpoint: str, arguments: dict, *, kind: str) -> dict:
        with self._lock:
            self.calls.append((endpoint, arguments))
        if endpoint in self.fail:
            raise self.fail[endpoint]
        if kind == "text":
            return {"output": self.storyboard}
        if kind == "video":
            return {"video": {"url": "https://cdn.test/clip.mp4"}}
        if kind == "upscale":
            return {"image": {"url": "https://cdn.test/grand.png"}}
        return {"images": [{"url": f"https://cdn.test/{index}.png"} for index in range(arguments["num_images"])]}

    def download(self, url: str, base: Path) -> Path:
        path = base.with_name(base.name + Path(url).suffix)
        write_atomic(path, url.encode())
        return path

    def close(self) -> None:
        self.closed = True
