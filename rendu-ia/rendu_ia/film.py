"""Film à partir d'images fixes, sur le PC, sans IA, sans compte et sans carte graphique (gratuit).

Chaque image devient un plan de cinéma : la caméra avance, recule ou tourne lentement, avec le très
léger flottement d'une caméra portée ; la lumière des fenêtres et des lampes monte et descend doucement,
comme quand un nuage passe ; les plans s'enchaînent en fondu, sous un grain de film fin.

Un panoramique est une vraie rotation de caméra (l'image est reprojetée, les fuyantes bougent), pas un
simple glissement de l'image. Une image fixe ne contient pas de relief : pour tourner autour des meubles,
il faut une vidéo de visite calculée en 3D (Twinmotion) ou un modèle vidéo (Flow).
"""
from __future__ import annotations

import math
import os
import re
import subprocess
import unicodedata
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from .config import ConfigError
from .montage import ffmpeg_exe
from .retouche import glow, light_field, read_image

WIDTH = 1920
FORMATS = {"cinema": 2.39, "16/9": 16 / 9}
FPS = 24
FIELD_OF_VIEW = 70.0     # angle horizontal supposé des vues 3D, en degrés
MOVES = ("avant", "arriere", "gauche", "droite", "haut", "bas", "fixe")
REST_ZOOM = 1.05         # léger recadrage : la place qu'il faut au flottement de la caméra
PUSH = 0.2               # agrandissement pendant une avancée ou un recul
PAN_ZOOM = 1.2           # recadrage pendant un panoramique, pour avoir de quoi tourner
MAX_TURN = 4.5           # demi-angle d'un panoramique, en degrés : au-delà il irait trop vite
MARGIN = 0.015           # le cadre reste à cette distance du bord de l'image (flottement compris)
LIGHT_PERIOD = 12.0      # secondes d'une montée et descente de la lumière
MAPS_SCALE = 4           # les cartes de lumière sont calculées et déplacées en petit

PLAN_HEADER = """\
# Plan du film : un plan par ligne, dans l'ordre du film (les lignes qui commencent par # sont ignorées).
#     vue : mouvement              ou              vue : mouvement vers X,Y
# Mouvements : avant, arriere (la caméra avance ou recule), gauche, droite, haut, bas (elle tourne), fixe.
# « vers X,Y » : point visé, en % de l'image (0,0 en haut à gauche, 50,50 au centre, 100,100 en bas à droite).
# Supprimez une ligne pour retirer un plan, déplacez-la pour changer l'ordre.
"""


@dataclass(frozen=True)
class Shot:
    image: Path
    move: str
    target: tuple[float, float] | None = None    # point visé, en fraction de l'image


# --- Plan du film ----------------------------------------------------------------------------------

def plain(word: str) -> str:
    """Minuscules sans accents : « Arrière » -> « arriere »."""
    return "".join(char for char in unicodedata.normalize("NFD", word.lower()) if unicodedata.category(char) != "Mn")


def parse_plan(text: str, images: list[Path]) -> list[Shot]:
    by_name = {path.stem.lower(): path for path in images}
    shots = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        name, _, rest = line.partition(":")
        image = by_name.get(name.strip().lower())
        if image is None:
            raise ConfigError(f"film.txt, ligne {number} : vue « {name.strip()} » inconnue "
                              f"(vues disponibles : {', '.join(path.stem for path in images) or 'aucune'}).")
        match = re.fullmatch(r"(\w+)(?:\s+vers\s+(\d+(?:\.\d+)?)\s*[,;]\s*(\d+(?:\.\d+)?))?", plain(rest.strip()))
        if not match or match.group(1) not in MOVES:
            raise ConfigError(f"film.txt, ligne {number} : mouvement « {rest.strip()} » non compris. Écrire par "
                              f"exemple « {image.stem} : avant vers 50,45 » (mouvements : {', '.join(MOVES)}).")
        target = None
        if match.group(2):
            target = (min(float(match.group(2)), 100) / 100, min(float(match.group(3)), 100) / 100)
        shots.append(Shot(image, match.group(1), target))
    if not shots:
        raise ConfigError("film.txt ne contient aucun plan : supprimez-le pour qu'il soit réécrit.")
    return shots


def light_centre(path: Path) -> tuple[float, float]:
    """Centre de la lumière d'une image, en fraction de l'image ; son milieu s'il n'y a pas de source."""
    image = read_image(path)
    height, width = image.shape[:2]
    ratio = 480 / max(width, 480)
    small = cv2.resize(image, (round(width * ratio), round(height * ratio)), interpolation=cv2.INTER_AREA)
    field = light_field(small.astype(np.float32) / 255)
    total = float(field.sum())
    if total <= 0:
        return 0.5, 0.5
    ys, xs = np.mgrid[0:field.shape[0], 0:field.shape[1]]
    return float((xs * field).sum() / total / field.shape[1]), float((ys * field).sum() / total / field.shape[0])


def automatic_plan(images: list[Path]) -> list[Shot]:
    """Sans plan écrit : la caméra avance vers la lumière, tourne vers elle un plan sur trois, et recule
    sur le dernier plan pour finir sur une vue d'ensemble."""
    shots = []
    for index, path in enumerate(images):
        x, y = light_centre(path)
        if len(images) >= 3 and index == len(images) - 1:
            shots.append(Shot(path, "arriere"))
        elif index % 3 == 2 and abs(x - 0.5) > 0.05:
            shots.append(Shot(path, "gauche" if x < 0.5 else "droite"))
        else:
            shots.append(Shot(path, "avant", (round(0.5 + 0.3 * (x - 0.5), 2), round(0.47 + 0.15 * (y - 0.5), 2))))
    return shots


def format_plan(shots: list[Shot]) -> str:
    lines = [PLAN_HEADER]
    for shot in shots:
        aim = f" vers {shot.target[0] * 100:.0f},{shot.target[1] * 100:.0f}" if shot.target else ""
        lines.append(f"{shot.image.stem} : {shot.move}{aim}\n")
    return "".join(lines)


# --- Caméra ----------------------------------------------------------------------------------------

class Camera:
    """Caméra qui regarde une image fixe : elle vise un point de l'image, avec un zoom et un léger roulis.
    `matrix` donne la projection de l'image vers la vidéo pour une position de la caméra."""

    def __init__(self, width: int, height: int, out_width: int, out_height: int):
        self.width, self.height = width, height
        self.out_width, self.out_height = out_width, out_height
        self.focal = (width / 2) / math.tan(math.radians(FIELD_OF_VIEW) / 2)
        self.fit = min(width, height * out_width / out_height)     # largeur d'image vue au zoom 1

    @property
    def centre(self) -> tuple[float, float]:
        return self.width / 2, self.height / 2

    def matrix(self, look: tuple[float, float], zoom: float, roll: float = 0.0) -> np.ndarray:
        cx, cy = self.centre
        forward = np.array([(look[0] - cx) / self.focal, (look[1] - cy) / self.focal, 1.0])
        forward /= np.linalg.norm(forward)
        right = np.cross([0.0, 1.0, 0.0], forward)
        right /= np.linalg.norm(right)
        down = np.cross(forward, right)
        if roll:
            cos, sin = math.cos(roll), math.sin(roll)
            right, down = cos * right + sin * down, cos * down - sin * right
        focal_out = zoom * self.focal * self.out_width / self.fit
        to_video = np.array([[focal_out, 0, self.out_width / 2], [0, focal_out, self.out_height / 2], [0, 0, 1]])
        from_image = np.array([[1 / self.focal, 0, -cx / self.focal], [0, 1 / self.focal, -cy / self.focal],
                               [0, 0, 1]])
        return to_video @ np.stack([right, down, forward]) @ from_image

    def inside(self, look: tuple[float, float], zoom: float) -> bool:
        """Le cadre de la vidéo, marge comprise, reste-t-il dans l'image ?"""
        mx, my = MARGIN * self.out_width, MARGIN * self.out_height
        xs = (-mx, self.out_width / 2, self.out_width + mx)
        ys = (-my, self.out_height / 2, self.out_height + my)
        frame = np.array([[x, y, 1.0] for x in xs for y in ys]).T
        points = np.linalg.inv(self.matrix(look, zoom)) @ frame
        if (points[2] <= 0).any():
            return False
        px, py = points[0] / points[2], points[1] / points[2]
        return bool((px >= 0).all() and (px <= self.width - 1).all() and (py >= 0).all()
                    and (py <= self.height - 1).all())

    def reach(self, look: tuple[float, float], zoom: float) -> tuple[float, float]:
        """Le point visé le plus proche de `look` pour lequel le cadre reste dans l'image."""
        if self.inside(look, zoom):
            return look
        cx, cy = self.centre
        low, high = 0.0, 1.0
        for _ in range(20):
            middle = (low + high) / 2
            if self.inside((cx + (look[0] - cx) * middle, cy + (look[1] - cy) * middle), zoom):
                low = middle
            else:
                high = middle
        return cx + (look[0] - cx) * low, cy + (look[1] - cy) * low


Position = tuple[tuple[float, float], float]     # point visé dans l'image (pixels) et zoom


def camera_path(camera: Camera, shot: Shot) -> tuple[Position, Position]:
    """Position de la caméra au début et à la fin du plan."""
    cx, cy = camera.centre
    if shot.move in ("avant", "arriere"):
        fx, fy = shot.target or (0.5, 0.47)
        aim = (fx * camera.width, fy * camera.height)
        near = (cx + 0.3 * (aim[0] - cx), cy + 0.3 * (aim[1] - cy))
        wide = (camera.reach(near, REST_ZOOM), REST_ZOOM)
        close = (camera.reach(aim, REST_ZOOM + PUSH), REST_ZOOM + PUSH)
        return (wide, close) if shot.move == "avant" else (close, wide)
    if shot.move == "fixe":
        return ((cx, cy), REST_ZOOM), ((cx, cy), REST_ZOOM + 0.03)
    turn = camera.focal * math.tan(math.radians(MAX_TURN))
    dx, dy = {"gauche": (-1, 0), "droite": (1, 0), "haut": (0, -1), "bas": (0, 1)}[shot.move]
    start = camera.reach((cx - dx * turn, cy - dy * turn), PAN_ZOOM)
    end = camera.reach((cx + dx * turn, cy + dy * turn), PAN_ZOOM)
    return (start, PAN_ZOOM), (end, PAN_ZOOM)


def ease(t: float) -> float:
    """Mouvement presque constant, adouci au départ et à l'arrivée."""
    return 0.65 * t + 0.35 * t * t * (3 - 2 * t)


def smooth(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


class Plan:
    """Un plan prêt à être filmé : image à la bonne taille, cartes de lumière, trajet de la caméra."""

    def __init__(self, shot: Shot, out_width: int, out_height: int):
        image = read_image(shot.image)
        height, width = image.shape[:2]
        # Image ramenée à la taille utile au zoom le plus fort (filtre « area » : pas de crénelage).
        scale = (REST_ZOOM + PUSH) * out_width / min(width, height * out_width / out_height)
        if scale < 1:
            image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        self.image = image.astype(np.float32) / 255
        height, width = image.shape[:2]
        self.camera = Camera(width, height, out_width, out_height)
        self.start, self.end = camera_path(self.camera, shot)
        small = (max(width // MAPS_SCALE, 2), max(height // MAPS_SCALE, 2))
        field = cv2.resize(light_field(self.image), small, interpolation=cv2.INTER_AREA)
        halo = cv2.resize(glow(self.image), small, interpolation=cv2.INTER_AREA)
        self.maps = np.dstack([field, halo])
        self.field_mean = float(field.mean())
        random = np.random.default_rng(zlib.crc32(shot.image.stem.encode("utf-8")))
        self.phases = random.uniform(0, 2 * math.pi, 6)

    def frame(self, t: float, seconds: float) -> np.ndarray:
        """Image du plan à la fraction `t` de sa durée."""
        camera, phases, time = self.camera, self.phases, t * seconds
        p = ease(t)
        (x0, y0), zoom0 = self.start
        (x1, y1), zoom1 = self.end
        zoom = zoom0 + (zoom1 - zoom0) * p
        # Flottement d'une caméra portée : quelques pixels, très lent, jamais deux fois pareil.
        sway = camera.fit / zoom
        look = (x0 + (x1 - x0) * p + 0.0022 * sway * (math.sin(time / 7.3 * 2 * math.pi + phases[0])
                                                      + 0.5 * math.sin(time / 3.1 * 2 * math.pi + phases[1])) / 1.5,
                y0 + (y1 - y0) * p + 0.0016 * sway * (math.sin(time / 6.1 * 2 * math.pi + phases[2])
                                                      + 0.5 * math.sin(time / 2.7 * 2 * math.pi + phases[3])) / 1.5)
        roll = math.radians(0.05) * math.sin(time / 8.3 * 2 * math.pi + phases[4])
        matrix = camera.matrix(look, zoom, roll)
        size = (camera.out_width, camera.out_height)
        picture = cv2.warpPerspective(self.image, matrix, size, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        # Jeu de lumière : les sources et leur lumière montent et descendent lentement.
        shrink = np.diag([1 / MAPS_SCALE, 1 / MAPS_SCALE, 1.0])
        small = (math.ceil(size[0] / MAPS_SCALE), math.ceil(size[1] / MAPS_SCALE))
        maps = cv2.warpPerspective(self.maps, shrink @ matrix @ np.linalg.inv(shrink), small,
                                   flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        maps = cv2.resize(maps, size, interpolation=cv2.INTER_LINEAR)
        level = math.sin(time / LIGHT_PERIOD * 2 * math.pi + phases[5])      # -1 à 1
        picture = picture * (1 + 0.09 * level * (maps[..., :1] - self.field_mean))
        return 1 - (1 - np.clip(picture, 0, 1)) * (1 - (0.14 + 0.1 * level) * maps[..., 1:])


# --- Rendu du film -----------------------------------------------------------------------------------

def frame_size(ratio: float, width: int = WIDTH) -> tuple[int, int]:
    return width, round(width / ratio / 2) * 2


def film_seconds(count: int, seconds: float, dissolve: float) -> float:
    return (seconds - dissolve) * (count - 1) + seconds


def render(shots: list[Shot], target: Path, *, ratio: float = FORMATS["cinema"], width: int = WIDTH,
           fps: int = FPS, seconds: float = 5.5, dissolve: float = 1.2,
           progress: Callable[[int, int], None] | None = None) -> float:
    """Filme les plans dans `target` (MP4, sans le son) et rend la durée du film."""
    if not shots:
        raise ConfigError("Aucun plan à filmer.")
    out_width, out_height = frame_size(ratio, width)
    dissolve = min(dissolve, seconds / 3) if len(shots) > 1 else 0.0
    step = seconds - dissolve
    total = film_seconds(len(shots), seconds, dissolve)
    fade_in, fade_out = min(1.0, total / 4), min(1.5, total / 4)
    frames = round(total * fps)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.name}.{os.getpid()}.tmp")
    encoder = subprocess.Popen(
        [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s", f"{out_width}x{out_height}", "-r", str(fps), "-i", "-", "-an", "-c:v", "libx264", "-preset", "slow",
         "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4", str(temporary)],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    grain = np.random.default_rng(7)
    plans: dict[int, Plan] = {}
    try:
        for number in range(frames):
            time = number / fps
            picture = np.zeros((out_height, out_width, 3), np.float32)
            weight = 0.0
            for index, shot in enumerate(shots):
                local = time - index * step
                if local < 0:
                    break
                if local >= seconds:
                    plans.pop(index, None)      # plan terminé : sa mémoire est rendue
                    continue
                alpha = 1.0
                if index > 0 and dissolve:
                    alpha = min(alpha, local / dissolve)
                if index < len(shots) - 1 and dissolve:
                    alpha = min(alpha, (seconds - local) / dissolve)
                alpha = smooth(alpha)
                if alpha <= 0:
                    continue
                if index not in plans:
                    plans[index] = Plan(shot, out_width, out_height)
                picture += alpha * plans[index].frame(local / seconds, seconds)
                weight += alpha
            picture /= max(weight, 1e-6)
            # Noirs de film très légèrement relevés, hautes lumières adoucies.
            picture = 0.02 + 0.965 * picture - 0.06 * np.maximum(picture - 0.85, 0)
            # Grain de film animé, fin, plus présent dans les tons moyens.
            lum = picture.mean(axis=2, keepdims=True)
            noise = cv2.GaussianBlur(grain.normal(0, 1, (out_height, out_width)).astype(np.float32), (0, 0), 0.5)
            picture += 0.01 * noise[..., None] * (0.35 + 2.6 * lum * (1 - lum))
            picture *= smooth(min(1.0, time / fade_in, (total - time) / fade_out))
            encoder.stdin.write((np.clip(picture, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
            if progress:
                progress(number + 1, frames)
        encoder.stdin.close()
    except BrokenPipeError:
        pass                                    # ffmpeg s'est arrêté : son message est lu ci-dessous
    except BaseException:
        encoder.kill()
        encoder.wait()
        temporary.unlink(missing_ok=True)
        raise
    error = encoder.stderr.read().decode("utf-8", "replace")
    if encoder.wait() != 0:
        temporary.unlink(missing_ok=True)
        raise ConfigError(f"ffmpeg n'a pas pu écrire le film : {error.strip()[-600:]}")
    os.replace(temporary, target)
    return total
