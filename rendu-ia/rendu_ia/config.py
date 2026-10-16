"""Réglages lus dans le fichier .env : clé fal.ai, modèles et paramètres de rendu."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

from .prompts import NEGATIVE_VIDEO

PROJECT_DIR = Path(__file__).resolve().parent.parent


class ConfigError(RuntimeError):
    """Réglage manquant ou invalide."""


class FatalError(RuntimeError):
    """Erreur qui toucherait toutes les images (clé refusée, crédit épuisé...) : on s'arrête."""


@dataclass(frozen=True)
class VideoModel:
    endpoint: str
    image_field: str   # nom du champ de l'image de départ : il change d'un modèle à l'autre
    min_seconds: int
    max_seconds: int
    options: dict = field(default_factory=dict)  # paramètres envoyés en plus du prompt et de la durée


# Les deux modèles vidéo cités dans la vidéo de référence, tels que fal.ai les expose.
VIDEO_MODELS = {
    "kling": VideoModel("fal-ai/kling-video/v3/pro/image-to-video", "start_image_url", 3, 15,
                        {"generate_audio": False, "negative_prompt": NEGATIVE_VIDEO}),
    "seedance": VideoModel("bytedance/seedance-2.0/image-to-video", "image_url", 4, 15,
                           {"resolution": "720p", "aspect_ratio": "auto", "generate_audio": False}),
}

PROVIDERS = ("gemini", "fal")
RESOLUTIONS = ("1K", "2K", "4K")
# Limites des modèles d'image Gemini (guide officiel Nano Banana, octobre 2026) : nombre d'images
# en entrée et définition maximale. Nano Banana 2 Lite est le seul présenté comme gratuit.
FREE_IMAGE_MODEL = "gemini-3.1-flash-lite-image"
GEMINI_IMAGE_LIMITS = {FREE_IMAGE_MODEL: (3, "1K")}
DEFAULT_IMAGE_LIMITS = (14, "4K")
ASPECT_RATIOS = ("auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16")
NO_MODEL = ("aucun", "none")


@dataclass(frozen=True)
class Settings:
    # Fournisseur des images, du storyboard et de l'upscale : « gemini » (clé Google AI Studio,
    # crédits inclus dans l'abonnement Google AI Pro) ou « fal » (fal.ai). Les vidéos passent
    # toujours par fal.ai ; sans clé fal.ai, le programme prépare une fiche pour Flow.
    provider: str = "fal"
    gemini_key: str = ""
    gemini_image_model: str = "gemini-3-pro-image"          # Nano Banana Pro
    gemini_text_model: str | None = "gemini-3.5-flash"      # None : plans types
    fal_key: str = ""
    image_model: str = "fal-ai/nano-banana-pro/edit"
    resolution: str = "2K"
    aspect_ratio: str = "auto"   # « auto » : même format que l'image d'entrée
    # Modèle de texte (vision) pour écrire le storyboard, via OpenRouter sur fal.ai. None : plans types.
    llm_model: str | None = "anthropic/claude-sonnet-5.5"
    upscale_model: str = "fal-ai/seedvr/upscale/image"
    upscale_factor: float = 2.0
    video_name: str = "kling"
    video: VideoModel = VIDEO_MODELS["kling"]
    video_seconds: int = 5
    parallel: int = 3            # demandes envoyées en même temps
    # Paramètres ajoutés tels quels aux demandes (réglage avancé, si un modèle change ses options).
    image_options: dict = field(default_factory=dict)
    upscale_options: dict = field(default_factory=dict)
    video_options: dict = field(default_factory=dict)

    @property
    def image_limits(self) -> tuple[int, str]:
        """Nombre maximal d'images envoyées et définition maximale du modèle d'image."""
        if self.provider == "gemini":
            return GEMINI_IMAGE_LIMITS.get(self.gemini_image_model, DEFAULT_IMAGE_LIMITS)
        return DEFAULT_IMAGE_LIMITS

    @property
    def has_key(self) -> bool:
        """Clé API du fournisseur choisi présente."""
        return bool(self.gemini_key if self.provider == "gemini" else self.fal_key)

    @property
    def text_model(self) -> str | None:
        """Modèle qui écrit le storyboard chez le fournisseur choisi (None : plans types)."""
        return self.gemini_text_model if self.provider == "gemini" else self.llm_model

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(PROJECT_DIR / ".env")
        gemini_key = _env("GEMINI_API_KEY") or _env("GOOGLE_API_KEY")
        provider = _env("RENDU_FOURNISSEUR", "gemini" if gemini_key else "fal").lower()
        if provider not in PROVIDERS:
            raise ConfigError(f"RENDU_FOURNISSEUR doit valoir {' ou '.join(PROVIDERS)}.")
        gemini_image_model = _env("RENDU_GEMINI_MODELE_IMAGE", "gemini-3-pro-image")
        max_resolution = (GEMINI_IMAGE_LIMITS.get(gemini_image_model, DEFAULT_IMAGE_LIMITS)[1]
                          if provider == "gemini" else "4K")
        resolution = _env("RENDU_RESOLUTION").upper()
        if resolution and resolution not in RESOLUTIONS:
            raise ConfigError(f"RENDU_RESOLUTION doit valoir {', '.join(RESOLUTIONS)}.")
        if resolution and RESOLUTIONS.index(resolution) > RESOLUTIONS.index(max_resolution):
            raise ConfigError(f"Le modèle {gemini_image_model} ne produit pas d'image en {resolution} "
                              f"({max_resolution} au plus) : corrigez RENDU_RESOLUTION.")
        # Par défaut 2K, ou moins si le modèle ne va pas jusque-là.
        resolution = resolution or min("2K", max_resolution, key=RESOLUTIONS.index)
        aspect_ratio = _env("RENDU_FORMAT", "auto").lower()
        if aspect_ratio not in ASPECT_RATIOS:
            raise ConfigError(f"RENDU_FORMAT doit valoir {', '.join(ASPECT_RATIOS)}.")
        video_name = _env("RENDU_MODELE_VIDEO", "kling").lower()
        if video_name not in VIDEO_MODELS:
            raise ConfigError(f"RENDU_MODELE_VIDEO doit valoir {' ou '.join(VIDEO_MODELS)}.")
        video = VIDEO_MODELS[video_name]
        if endpoint := _env("RENDU_ENDPOINT_VIDEO"):
            video = VideoModel(endpoint, video.image_field, video.min_seconds, video.max_seconds, video.options)
        try:
            upscale_factor = float(_env("RENDU_FACTEUR_UPSCALE", "2").replace(",", "."))
            video_seconds = int(_env("RENDU_DUREE_VIDEO", "5"))
            parallel = int(_env("RENDU_PARALLELE", "3"))
        except ValueError as exc:
            raise ConfigError(f"Valeur numérique invalide dans l'environnement : {exc}") from exc
        if not 1 <= upscale_factor <= 4:
            raise ConfigError("RENDU_FACTEUR_UPSCALE doit être entre 1 et 4 (par exemple 2).")
        if not 1 <= parallel <= 8:
            raise ConfigError("RENDU_PARALLELE doit être entre 1 et 8.")
        check_video_seconds(video, video_name, video_seconds)
        llm_model = _env("RENDU_MODELE_LLM", "anthropic/claude-sonnet-5.5")
        gemini_text_model = _env("RENDU_GEMINI_MODELE_TEXTE", "gemini-3.5-flash")
        return cls(
            provider=provider,
            gemini_key=gemini_key,
            gemini_image_model=gemini_image_model,
            gemini_text_model=None if gemini_text_model.lower() in NO_MODEL else gemini_text_model,
            fal_key=_env("FAL_KEY"),
            image_model=_env("RENDU_MODELE_IMAGE", "fal-ai/nano-banana-pro/edit"),
            resolution=resolution,
            aspect_ratio=aspect_ratio,
            llm_model=None if llm_model.lower() in NO_MODEL else llm_model,
            upscale_model=_env("RENDU_MODELE_UPSCALE", "fal-ai/seedvr/upscale/image"),
            upscale_factor=upscale_factor,
            video_name=video_name,
            video=video,
            video_seconds=video_seconds,
            parallel=parallel,
            image_options=_json_options("RENDU_OPTIONS_IMAGE"),
            upscale_options=_json_options("RENDU_OPTIONS_UPSCALE"),
            video_options=_json_options("RENDU_OPTIONS_VIDEO"),
        )


def check_video_seconds(video: VideoModel, name: str, seconds: int) -> None:
    if not video.min_seconds <= seconds <= video.max_seconds:
        raise ConfigError(f"Durée de vidéo impossible avec {name} : entre {video.min_seconds} "
                          f"et {video.max_seconds} secondes.")


def _env(name: str, default: str = "") -> str:
    """Variable d'environnement ; une valeur laissée vide dans .env compte comme absente."""
    return os.environ.get(name, "").strip() or default


def _json_options(name: str) -> dict:
    raw = _env(name)
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{name} n'est pas un JSON valide : {exc}") from exc
    if not isinstance(value, dict):
        raise ConfigError(f'{name} doit être un objet JSON, par exemple {{"seed": 42}}.')
    return value
