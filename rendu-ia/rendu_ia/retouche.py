"""Retouche photo des vues sur le PC, sans IA, sans compte et sans carte graphique (gratuit).

Une capture Archicad a une lumière plate, des surfaces unies et des textures à grosses taches. La retouche
lui donne ce qu'une photo a de plus : une exposition juste, une lumière qui décroît en s'éloignant des
fenêtres et des lampes, des angles un peu plus sombres, des textures au grain fin, le halo des sources,
puis le vignetage et le grain d'un appareil photo. Rien n'est ajouté ni déplacé dans l'image.

Avec `finish=True`, la vue est déjà un rendu 3D (Twinmotion, PhotoRendu d'Archicad) : sa lumière et ses
matériaux sont gardés tels quels, seule la finition d'appareil photo est posée.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

UPSCALE_BELOW = 2600      # largeur sous laquelle l'image est d'abord doublée
REFERENCE_WIDTH = 3200    # largeur pour laquelle les rayons ci-dessous sont réglés
JPEG_QUALITY = 94


def read_image(path: Path) -> np.ndarray:
    """Image en couleurs BGR 8 bits ; passe par un tampon pour accepter les chemins accentués sous Windows."""
    image = cv2.imdecode(np.frombuffer(Path(path).read_bytes(), np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Image illisible : {path}")
    return image


def write_jpeg(path: Path, image: np.ndarray) -> None:
    done, data = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not done:
        raise ValueError(f"Image impossible à écrire : {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(data.tobytes())
    temporary.replace(path)


def luminance(image: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def blur(image: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(image, (0, 0), max(sigma, 0.3))


def light_field(image: np.ndarray) -> np.ndarray:
    """Où tombe la lumière des sources visibles (fenêtres, luminaires) : 1 près d'elles, 0 loin.
    Calculé en petit, puis remis à la taille de l'image ; nul s'il n'y a aucune source."""
    height, width = image.shape[:2]
    small = cv2.resize(image, (max(width // 8, 8), max(height // 8, 8)), interpolation=cv2.INTER_AREA)
    sources = np.clip((luminance(small) - 0.78) / 0.2, 0, 1)
    if float(sources.max()) < 0.2:
        return np.zeros((height, width), np.float32)
    unit = small.shape[1]
    field = 0.55 * blur(sources, unit * 0.07) + 0.45 * blur(sources, unit * 0.2)
    field /= max(float(np.percentile(field, 99.5)), 1e-4)
    return cv2.resize(np.clip(field, 0, 1), (width, height), interpolation=cv2.INTER_CUBIC)


def expose(image: np.ndarray) -> np.ndarray:
    """Exposition, points noir et blanc, balance des blancs : enlève le voile gris d'une capture."""
    lum = luminance(image)
    gamma = float(np.clip(np.log(0.42) / np.log(max(float(np.median(lum)), 1e-3)), 0.65, 1.0))
    image = np.power(np.clip(image, 0, 1), gamma).astype(np.float32)
    lum = luminance(image)
    black, white = np.percentile(lum, 0.5), np.percentile(lum, 99.7)
    image = np.clip((image - black * 0.7) / (max(white, 0.85) - black * 0.7), 0, 1)
    # Demi-correction « monde gris » sur les tons moyens, puis une touche chaude.
    middle = (lum > 0.15) & (lum < 0.85)
    if middle.any():
        means = image[middle].mean(axis=0)
        image = image * (0.5 + 0.5 * means.mean() / np.maximum(means, 1e-3))
    return (image * np.array([0.96, 1.0, 1.04], np.float32)).astype(np.float32)


def textures(lab: np.ndarray, rng: np.random.Generator, unit: float) -> np.ndarray:
    """Textures plus fines et plus vraies, sur la clarté seule (les couleurs ne bougent pas) :
    grandes taches des textures Archicad atténuées, détail fin renforcé, micro-relief des surfaces
    unies (peinture, tissu, bois). Les arêtes des meubles et des murs ne sont pas touchées."""
    light = lab[..., 0]
    # Grandes taches claires et sombres des enduits d'Archicad : ce qui sépare l'image d'une version
    # lissée sans toucher aux arêtes, calculé en petit. Elles passeraient pour des salissures.
    height, width = light.shape
    small = cv2.resize(light, (max(width // 8, 8), max(height // 8, 8)), interpolation=cv2.INTER_AREA)
    even = small
    for _ in range(3):
        even = cv2.bilateralFilter(even, 21, 5, 9)
    stains = cv2.resize(blur(small, 1.0) - even, (width, height), interpolation=cv2.INTER_CUBIC)
    light = light - 0.85 * stains
    low, base = blur(light, 24 * unit), blur(light, 2.5 * unit)
    slope = np.hypot(cv2.Sobel(base, cv2.CV_32F, 1, 0), cv2.Sobel(base, cv2.CV_32F, 0, 1))
    flat = blur(1 - np.clip(slope / 8, 0, 1), 4 * unit)
    result = low + (base - low) * (1 - 0.6 * flat) + (light - base) * (1 + 0.5 * flat)
    shape = light.shape
    fine = blur(rng.normal(0, 1, shape).astype(np.float32), 0.6 * unit)
    coarse = blur(rng.normal(0, 1, shape).astype(np.float32), 2.2 * unit)
    relief = 0.7 * fine / fine.std() + 0.3 * coarse / coarse.std()
    middle = np.clip(4 * (light / 100) * (1 - light / 100), 0, 1)       # ni dans les noirs, ni dans les blancs
    result *= 1 + 0.011 * relief * flat * middle
    lab[..., 0] = np.clip(result, 0, 100)
    return lab


def grade(image: np.ndarray, rng: np.random.Generator, unit: float) -> np.ndarray:
    """Contraste local, couleurs, textures, puis courbe en S douce d'un film."""
    lab = cv2.cvtColor(np.clip(image, 0, 1).astype(np.float32), cv2.COLOR_BGR2LAB)
    light8 = np.clip(lab[..., 0] * 2.55, 0, 255).astype(np.uint8)
    clahe = cv2.createCLAHE(clipLimit=1.2, tileGridSize=(8, 8)).apply(light8).astype(np.float32) / 2.55
    lab[..., 0] = 0.7 * lab[..., 0] + 0.3 * clahe
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    boost = 1.03 + 0.14 * np.clip(1 - chroma / 40, 0, 1)     # les couleurs ternes gagnent plus que les vives
    lab[..., 1] *= boost
    lab[..., 2] *= boost
    image = np.clip(cv2.cvtColor(textures(lab, rng, unit), cv2.COLOR_LAB2BGR), 0, 1)
    return image + 0.4 * image * (1 - image) * (2 * image - 1)


def relight(image: np.ndarray, unit: float) -> np.ndarray:
    """Jeu de lumière : la lumière décroît en s'éloignant des fenêtres et des lampes, et les angles
    où deux surfaces se rencontrent sont un peu plus sombres, comme dans une vraie pièce."""
    field = light_field(image)
    lum = luminance(image)
    if float(field.max()) > 0:
        gain = np.clip(0.96 + 0.3 * field, 0.96, 1.26)       # éclaircit près des sources, assombrit à peine loin
        # Les surfaces déjà claires (draps, plafond) ne sont pas poussées jusqu'au blanc.
        room = np.clip((0.92 - lum) / 0.35, 0, 1)
        image = image * (1 + (gain - 1) * np.where(gain > 1, room, 1))[..., None]
    lum = luminance(np.clip(image, 0, 1).astype(np.float32))
    base = blur(lum, 3 * unit)
    edges = np.clip(np.hypot(cv2.Sobel(base, cv2.CV_32F, 1, 0), cv2.Sobel(base, cv2.CV_32F, 0, 1)) * 14, 0, 1)
    corners = np.clip(blur(edges, 10 * unit) * 2.0, 0, 1)
    shade = 1 - 0.07 * corners * np.clip((0.9 - lum) / 0.3, 0, 1)        # les sources ne sont pas assombries
    return np.clip(image * shade[..., None], 0, 1)


def glow(image: np.ndarray) -> np.ndarray:
    """Halo des sources de lumière, légèrement chaud, à la taille de l'image."""
    height, width = image.shape[:2]
    bright = np.clip((luminance(image) - 0.82) / 0.18, 0, 1)[..., None] * image
    small = cv2.resize(bright, (max(width // 4, 8), max(height // 4, 8)), interpolation=cv2.INTER_AREA)
    sigma = small.shape[1] * 0.012
    halo = blur(small, sigma) + 0.5 * blur(small, sigma * 3) + 0.25 * blur(small, sigma * 8)
    halo = cv2.resize(halo, (width, height), interpolation=cv2.INTER_LINEAR)
    return np.clip(halo * np.array([0.8, 0.93, 1.0], np.float32), 0, 1)


def bloom(image: np.ndarray, strength: float) -> np.ndarray:
    """Pose le halo des sources sur l'image, comme le fait un objectif."""
    return 1 - (1 - image) * (1 - strength * glow(image))


def camera(image: np.ndarray, rng: np.random.Generator, unit: float, vignette: float, grain: float) -> np.ndarray:
    """Vignetage léger et grain fin de luminance, plus visible dans les tons moyens."""
    height, width = image.shape[:2]
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    radius = np.hypot((xs - width / 2) / (width / 2), (ys - height / 2) / (height / 2)) / np.sqrt(2)
    image = image * (1 - vignette * radius ** 2.2)[..., None]
    noise = blur(rng.normal(0, 1, (height, width)).astype(np.float32), 0.5 * unit)
    lum = luminance(np.clip(image, 0, 1).astype(np.float32))
    return image + (grain * noise * (0.4 + 2.4 * lum * (1 - lum)))[..., None]


def retouch(bgr: np.ndarray, seed: int = 0, finish: bool = False) -> np.ndarray:
    """Capture (BGR 8 bits) retouchée. `finish` : rendu 3D déjà éclairé, finition d'appareil photo seule."""
    rng = np.random.default_rng(seed)
    height, width = bgr.shape[:2]
    if not finish and width < UPSCALE_BELOW:
        # Agrandissement x2, puis lissage des bords en escalier en gardant les arêtes nettes.
        bgr = cv2.resize(bgr, (width * 2, height * 2), interpolation=cv2.INTER_LANCZOS4)
        bgr = cv2.bilateralFilter(bgr, 9, 28, 5)
    image = bgr.astype(np.float32) / 255.0
    unit = image.shape[1] / REFERENCE_WIDTH
    if finish:
        image = bloom(image, 0.2)
        image = camera(image, rng, unit, vignette=0.1, grain=0.01)
    else:
        image = relight(np.clip(grade(expose(image), rng, unit), 0, 1), unit)
        image = bloom(image, 0.35)
        image = np.clip(image + 0.55 * (image - blur(image, 1.6 * unit)), 0, 1)     # netteté, avant le grain
        image = camera(image, rng, unit, vignette=0.16, grain=0.012)
    return (np.clip(image, 0, 1) * 255 + 0.5).astype(np.uint8)


def retouch_file(source: Path, target: Path, seed: int = 0, finish: bool = False) -> None:
    write_jpeg(target, retouch(read_image(source), seed, finish))
