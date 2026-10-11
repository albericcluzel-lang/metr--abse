"""Images, storyboard et upscale par l'API Gemini de Google, avec une clé de Google AI Studio.

Les crédits Google Cloud inclus dans l'abonnement Google AI Pro paient ces appels une fois activés
(voir le README). Le modèle d'image est Nano Banana Pro (gemini-3-pro-image).
"""
from __future__ import annotations

import base64
import math
import re
import tempfile
import time
from pathlib import Path

import httpx
from PIL import Image, ImageOps

from . import prompts
from .config import ASPECT_RATIOS, ConfigError, FatalError, Settings
from .projet import write_atomic
from .service import CONTENT_TYPES, INPUT_MAX_SIDE, ServiceError, prepare_image

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
REFERENCE_MAX_SIDE = 1280   # image maître et références : elles ne donnent que le style
RETRY_DELAYS = (5, 15, 30, 60)   # secondes d'attente avant chaque nouvelle tentative
RETRY_STATUSES = (429, 500, 502, 503, 504)   # saturation ou panne passagère
MIME_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


class GeminiProvider:
    """Une demande par image : le modèle d'image de Gemini ne rend qu'une image à la fois."""

    name = "Gemini"

    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None, sleep=time.sleep):
        if not settings.gemini_key:
            raise ConfigError("GEMINI_API_KEY manquante : clé de Google AI Studio, voir le README, étape 1.")
        self.settings = settings
        self._http = httpx.Client(headers={"x-goog-api-key": settings.gemini_key},
                                  timeout=httpx.Timeout(330, connect=30), transport=transport)
        self._sleep = sleep
        self._workdir = tempfile.TemporaryDirectory(prefix="rendu_ia_")

    def close(self) -> None:
        self._http.close()
        self._workdir.cleanup()

    def generate_images(self, prompt: str, inputs: list[Path], targets: list[Path]) -> list[Path]:
        # La consigne d'abord, puis les images dans l'ordre où elle les cite (image 1, image 2...).
        parts = [{"text": prompt}] + [
            self._image_part(path, INPUT_MAX_SIDE if index == 0 else REFERENCE_MAX_SIDE)
            for index, path in enumerate(inputs)]
        ratio = self.settings.aspect_ratio
        if ratio == "auto":
            ratio = closest_ratio(inputs[0])
        return [self._render(parts, ratio, self.settings.resolution, target) for target in targets]

    def write_text(self, image: Path, system: str, prompt: str) -> str:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}, self._image_part(image, INPUT_MAX_SIDE)]}],
            "generationConfig": {"responseMimeType": "application/json"},
        }
        parts = _parts(self._post(self.settings.gemini_text_model, body))
        return "".join(part.get("text", "") for part in parts if not part.get("thought"))

    def upscale(self, source: Path, target: Path) -> Path:
        """Pas de modèle d'upscale chez Gemini : l'image est régénérée en 4K par Nano Banana Pro."""
        parts = [{"text": prompts.UPSCALE_PROMPT}, self._image_part(source, INPUT_MAX_SIDE)]
        return self._render(parts, closest_ratio(source), "4K", target)

    def _render(self, parts: list[dict], ratio: str, size: str, target: Path) -> Path:
        body = {
            "contents": [{"role": "user", "parts": parts}],
            # TEXT en plus d'IMAGE : en cas de refus, le modèle explique pourquoi.
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"],
                                 "imageConfig": {"aspectRatio": ratio, "imageSize": size}},
        }
        body["generationConfig"].update(self.settings.image_options)
        data, mime_type = final_image(self._post(self.settings.gemini_image_model, body))
        path = target.with_name(target.name + CONTENT_TYPES.get(mime_type, ".png"))
        write_atomic(path, data)
        return path

    def _image_part(self, path: Path, max_side: int) -> dict:
        prepared = prepare_image(path, max_side, Path(self._workdir.name))
        mime_type = MIME_TYPES.get(prepared.suffix.lower(), "image/png")
        return {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(prepared.read_bytes()).decode()}}

    def _post(self, model: str | None, body: dict) -> dict:
        url = API_URL.format(model=model)
        for attempt in range(len(RETRY_DELAYS) + 1):
            last = attempt == len(RETRY_DELAYS)
            try:
                response = self._http.post(url, json=body)
            except httpx.HTTPError as exc:
                if last:
                    raise ServiceError(f"erreur réseau avec Gemini : {exc}") from exc
                self._sleep(RETRY_DELAYS[attempt])
                continue
            if response.status_code == 200:
                return response.json()
            error = _error(response)
            check_fatal(response.status_code, error, model)
            if response.status_code in RETRY_STATUSES and not last:
                self._sleep(retry_delay(error, RETRY_DELAYS[attempt]))
                continue
            raise ServiceError(f"refusé par Gemini ({response.status_code} {error.get('status', '')}) : "
                               f"{error.get('message', response.text[:300])}")
        raise AssertionError("inatteignable")


def check_fatal(status_code: int, error: dict, model: str | None) -> None:
    """Erreurs qui toucheraient toutes les images : on arrête tout de suite au lieu de payer pour rien."""
    message = str(error.get("message", ""))
    if "API_KEY_INVALID" in str(error) or "API key not valid" in message:
        raise FatalError("Google refuse la clé GEMINI_API_KEY : vérifiez-la dans Google AI Studio.")
    if status_code == 429 and "limit: 0" in message:
        raise FatalError("Le projet de la clé n'a pas de facturation active : la génération d'images n'est pas "
                         "gratuite. Activez les crédits Google AI Pro et rattachez-les au projet de la clé "
                         f"(README, étape 1). Détail : {message}")
    if status_code in (401, 403) or error.get("status") == "FAILED_PRECONDITION":
        raise FatalError(f"Google refuse l'accès ({status_code}) : {message}")
    if status_code == 404:
        raise FatalError(f"Modèle « {model} » introuvable chez Google : vérifiez RENDU_GEMINI_MODELE_IMAGE "
                         f"et RENDU_GEMINI_MODELE_TEXTE. Détail : {message}")


def retry_delay(error: dict, default: float) -> float:
    """Délai demandé par Google (« retryDelay »), limité à une minute."""
    for detail in error.get("details") or []:
        match = re.fullmatch(r"(\d+(?:\.\d+)?)s", str(detail.get("retryDelay", "")))
        if match:
            return min(float(match.group(1)), 60.0)
    return default


def final_image(result: dict) -> tuple[bytes, str]:
    """L'image finale de la réponse. Nano Banana Pro « réfléchit » en produisant des images
    intermédiaires, marquées « thought » : elles sont ignorées."""
    parts = _parts(result)
    images = [part for part in parts if part.get("inlineData") or part.get("inline_data")]
    final = [part for part in images if not part.get("thought")] or images
    if not final:
        candidate = (result.get("candidates") or [{}])[0]
        text = " ".join(part.get("text", "") for part in parts if not part.get("thought")).strip()
        raise ServiceError(f"aucune image reçue (fin : {candidate.get('finishReason', 'inconnue')})"
                           + (f". Réponse du modèle : {text}" if text else ""))
    inline = final[-1].get("inlineData") or final[-1]["inline_data"]
    return base64.b64decode(inline["data"]), inline.get("mimeType") or inline.get("mime_type") or "image/png"


def closest_ratio(path: Path) -> str:
    """Format accepté par le modèle le plus proche de celui de l'image (une capture verticale reste verticale)."""
    with Image.open(path) as opened:
        width, height = ImageOps.exif_transpose(opened).size
    target = math.log(width / height)
    ratios = [ratio for ratio in ASPECT_RATIOS if ratio != "auto"]
    return min(ratios, key=lambda ratio: abs(math.log(_value(ratio)) - target))


def _value(ratio: str) -> float:
    width, height = ratio.split(":")
    return int(width) / int(height)


def _parts(result: dict) -> list[dict]:
    candidates = result.get("candidates") or []
    if not candidates:
        reason = (result.get("promptFeedback") or {}).get("blockReason")
        raise ServiceError(f"demande bloquée par le filtre de Gemini ({reason})" if reason
                           else "réponse vide de Gemini")
    return (candidates[0].get("content") or {}).get("parts") or []


def _error(response: httpx.Response) -> dict:
    try:
        error = response.json().get("error")
    except ValueError:
        error = None
    return error if isinstance(error, dict) else {"message": response.text[:300]}
