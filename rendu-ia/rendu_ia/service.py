"""Accès aux modèles hébergés par fal.ai : une seule clé pour les images, le texte, l'upscale et la vidéo."""
from __future__ import annotations

import tempfile
import threading
from pathlib import Path
from typing import Protocol
from urllib.parse import urlparse

import httpx
from PIL import Image, ImageOps

from .config import ConfigError, FatalError, Settings
from .projet import IMAGE_SUFFIXES, VIDEO_SUFFIXES, write_atomic

INPUT_MAX_SIDE = 2048   # côté maximal des images envoyées aux modèles (rendu en 2K)
VISION_ENDPOINT = "openrouter/router/vision"   # modèles de texte qui lisent les images, via OpenRouter
TIMEOUTS = {"image": 600, "text": 300, "upscale": 900, "video": 1800}   # secondes, file d'attente comprise
CONTENT_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
                 "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm"}


class ServiceError(RuntimeError):
    """Une demande a échoué (refus du modèle, délai dépassé...) : les autres continuent."""


class Provider(Protocol):
    """Ce que les étapes demandent à un fournisseur (fal.ai ou Gemini)."""

    name: str

    def generate_images(self, prompt: str, inputs: list[Path], targets: list[Path]) -> list[Path]:
        """Une image par chemin de `targets` (sans extension), à partir des images `inputs`."""

    def write_text(self, image: Path, system: str, prompt: str) -> str:
        """Réponse du modèle de texte qui regarde `image` (storyboard)."""

    def upscale(self, source: Path, target: Path) -> Path: ...

    def close(self) -> None: ...


class Fal:
    """Envoie les fichiers à fal.ai, lance les demandes, attend et télécharge les résultats.

    Utilisable depuis plusieurs fils en même temps (demandes parallèles).
    """

    def __init__(self, key: str):
        if not key:
            raise ConfigError("FAL_KEY manquante : clé fal.ai, voir le README, étape 1.")
        import fal_client

        self._fal = fal_client
        self._client = fal_client.SyncClient(key=key)
        self._uploads: dict[tuple[Path, int | None], str] = {}
        self._lock = threading.Lock()
        self._workdir = tempfile.TemporaryDirectory(prefix="rendu_ia_")

    def close(self) -> None:
        self._workdir.cleanup()

    def upload(self, path: Path, *, max_side: int | None = INPUT_MAX_SIDE) -> str:
        """Adresse en ligne du fichier ; chaque fichier n'est envoyé qu'une fois par passage."""
        key = (path.resolve(), max_side)
        with self._lock:
            if key in self._uploads:
                return self._uploads[key]
        prepared = prepare_image(path, max_side, Path(self._workdir.name)) if max_side else path
        url = self._call(lambda: self._client.upload_file(prepared), f"envoi de {path.name}")
        with self._lock:
            self._uploads[key] = url
        return url

    def run(self, endpoint: str, arguments: dict, *, kind: str) -> dict:
        """Lance une demande et attend son résultat (file d'attente de fal.ai)."""
        return self._call(lambda: self._client.subscribe(endpoint, arguments, client_timeout=TIMEOUTS[kind]),
                          endpoint)

    def download(self, url: str, base: Path) -> Path:
        """Télécharge un résultat à côté de `base` (chemin sans extension) et renvoie le fichier écrit."""
        try:
            response = httpx.get(url, timeout=300, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ServiceError(f"téléchargement du résultat impossible : {exc}") from exc
        path = base.with_name(base.name + result_suffix(url, response.headers.get("content-type", "")))
        write_atomic(path, response.content)
        return path

    def _call(self, action, what: str):
        try:
            return action()
        except self._fal.FalClientHTTPError as exc:
            if exc.status_code in (401, 402, 403):
                raise FatalError(f"fal.ai refuse la demande : clé FAL_KEY invalide ou crédit épuisé "
                                 f"({exc.status_code} : {exc})") from exc
            raise ServiceError(f"{what} : refusé par fal.ai ({exc.status_code}) : {exc}") from exc
        except self._fal.FalClientTimeoutError as exc:
            raise ServiceError(f"{what} : délai dépassé ({exc})") from exc
        except httpx.HTTPError as exc:
            raise ServiceError(f"{what} : erreur réseau : {exc}") from exc


class FalProvider:
    """Images (Nano Banana Pro), storyboard, upscale et vidéo (Kling, Seedance) par fal.ai."""

    name = "fal.ai"

    def __init__(self, settings: Settings, client: Fal | None = None):
        self.settings = settings
        self.fal = client or Fal(settings.fal_key)

    def close(self) -> None:
        self.fal.close()

    def generate_images(self, prompt: str, inputs: list[Path], targets: list[Path]) -> list[Path]:
        arguments = {
            "prompt": prompt,
            "image_urls": [self.fal.upload(path) for path in inputs],
            "num_images": len(targets),
            "resolution": self.settings.resolution,
            "aspect_ratio": self.settings.aspect_ratio,
            "output_format": "png",
            **self.settings.image_options,
        }
        result = self.fal.run(self.settings.image_model, arguments, kind="image")
        urls = media_urls(result)
        if len(urls) < len(targets):
            note = f" Réponse du modèle : {result['description']}" if result.get("description") else ""
            raise ServiceError(f"{len(urls)} image(s) reçue(s) sur {len(targets)} demandée(s).{note}")
        return [self.fal.download(url, target) for url, target in zip(urls, targets)]

    def write_text(self, image: Path, system: str, prompt: str) -> str:
        arguments = {"model": self.settings.llm_model, "system_prompt": system, "prompt": prompt,
                     "image_urls": [self.fal.upload(image)]}
        return str(self.fal.run(VISION_ENDPOINT, arguments, kind="text").get("output", ""))

    def upscale(self, source: Path, target: Path) -> Path:
        arguments = {"image_url": self.fal.upload(source, max_side=None),
                     "upscale_factor": self.settings.upscale_factor, **self.settings.upscale_options}
        urls = media_urls(self.fal.run(self.settings.upscale_model, arguments, kind="upscale"))
        if not urls:
            raise ServiceError("aucune image reçue")
        return self.fal.download(urls[0], target)

    def animate(self, source: Path, prompt: str, target: Path) -> Path:
        video = self.settings.video
        arguments = {video.image_field: self.fal.upload(source), "prompt": prompt,
                     "duration": str(self.settings.video_seconds), **video.options, **self.settings.video_options}
        urls = media_urls(self.fal.run(video.endpoint, arguments, kind="video"))
        if not urls:
            raise ServiceError("aucune vidéo reçue")
        return self.fal.download(urls[0], target)


def prepare_image(path: Path, max_side: int, workdir: Path) -> Path:
    """Copie allégée de l'image à envoyer : réduite à `max_side` pixels, fond transparent remplacé par
    du blanc (un export Archicad peut avoir un fond transparent, qui deviendrait noir)."""
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened)
        transparent = image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info
        if max(image.size) <= max_side and not transparent and path.suffix.lower() in (".png", ".jpg", ".jpeg"):
            return path
        image.thumbnail((max_side, max_side), Image.LANCZOS)
        if transparent:
            rgba = image.convert("RGBA")
            image = Image.new("RGB", rgba.size, "white")
            image.paste(rgba, mask=rgba.getchannel("A"))
        handle, name = tempfile.mkstemp(suffix=".jpg", dir=workdir)
        with open(handle, "wb") as target:
            image.convert("RGB").save(target, format="JPEG", quality=92)
    return Path(name)


def media_urls(result: dict) -> list[str]:
    """Adresses des fichiers produits : clés « images », « image » ou « video » selon le modèle."""
    urls = []
    for key in ("images", "image", "video", "videos"):
        value = result.get(key)
        items = value if isinstance(value, list) else [value]
        urls += [item["url"] for item in items if isinstance(item, dict) and item.get("url")]
    return urls


def result_suffix(url: str, content_type: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in IMAGE_SUFFIXES + VIDEO_SUFFIXES:
        return ".jpg" if suffix == ".jpeg" else suffix
    return CONTENT_TYPES.get(content_type.split(";")[0].strip().lower(), ".bin")
