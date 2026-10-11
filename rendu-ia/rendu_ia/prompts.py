"""La recette du rendu : consignes envoyées aux modèles, tirées de l'analyse de la vidéo de référence.

Les consignes sont en anglais, la langue dans laquelle ces modèles suivent le mieux les
instructions. Le texte de `ambiance.txt` peut rester en français.

Le look visé (vidéo de référence) : photo d'intérieur de magazine, fin d'après-midi, soleil bas
qui passe à travers les stores et dessine des rayures sur le parquet, spots allumés en blanc chaud,
chêne naturel, murs grège mats, rendu couleur Fujifilm, verticales droites.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

# --- Rendu photo à partir d'une capture 3D Archicad --------------------------------------------

GEOMETRY_LOCK = (
    "Image 1 is a screenshot of the project's 3D model (ArchiCAD). It is the reference for everything "
    "that is built. Keep exactly the same camera position, viewing angle, focal length and framing; the "
    "same room geometry, walls, ceiling heights, beams, columns, openings, windows and doors; and the same "
    "furniture, light fittings, objects and artworks, in the same places, with the same shapes, sizes and "
    "colours. Do not add, remove, move or resize any architectural element or piece of furniture. "
    "Ignore the look of the 3D software: flat grey surfaces, missing textures, hard CG edges, black "
    "outlines, flat 2D cut-out plants or people, and any interface element."
)

MATERIALS = (
    "Materials: turn every surface into a real material with natural imperfections. Where the 3D model "
    "shows a material or a colour, keep it and make it real (a wood texture becomes real wood of the same "
    "tone and pattern, a coloured cabinet keeps its colour). Where a surface is plain grey or untextured, "
    "use: natural oak floor with visible grain and a satin finish, warm greige matte painted walls, white "
    "matte ceiling. Real fabrics (boucle, wool, linen, leather) with folds and texture, powder-coated or "
    "brushed metal, real glass with reflections, real plants with natural leaves. Styling: lived-in but "
    "tidy (books, records, ceramics, plants), no clutter."
)

LIGHT = (
    "Light: late-afternoon low sun. Warm direct sunlight comes through the windows and, where there are "
    "blinds, filters through them and casts crisp striped light patterns across the floor, rug and "
    "furniture. Soft warm bounce light fills the room. Recessed downlights and track spots are on, with a "
    "gentle warm 2700 K glow and soft light scallops on the walls. Balanced exposure: the windows are "
    "bright but not burnt out."
)

PHOTO_STYLE = (
    "Photography: high-end interior design editorial photograph, as published in an architecture "
    "magazine. Fujifilm medium-format camera with natural Fujifilm colour close to Classic Chrome: warm, "
    "slightly muted, natural tones, soft highlight roll-off, deep but open shadows, very fine film-like "
    "grain. Vertical lines perfectly straight. Sharp, realistic textures: no CGI look, no "
    "over-saturation, no HDR halos."
)

PEOPLE = (
    "People: add one or two people in casual, neutral-toned clothes, naturally going about their day "
    "(reading, walking, looking out of the window), photographed candidly and not looking at the camera. "
    "They must not hide the main architectural features."
)

SINGLE_IMAGE = (
    "Output a single photograph: no text, no caption, no watermark, no border, no split screen, no collage."
)


def render_prompt(*, master: bool, references: list[str], brief: str | None, people: bool) -> str:
    """Consigne pour transformer la capture 3D (image 1) en photo.

    Ordre des images envoyées : capture, image maître (si `master`), puis références.
    `references` : nom de chaque photo de référence, qui dit à quoi elle sert.
    """
    parts = [GEOMETRY_LOCK]
    index = 2
    if master:
        parts.append(
            f"Image {index} is the approved master image of the project: match its materials, colour "
            "palette, light, white balance and photographic style exactly, so that all the images look "
            "like the same photo shoot in the same home. Take only the style from it, never its framing "
            "or its furniture layout."
        )
        index += 1
    if references:
        listed = "; ".join(f"image {index + offset}: {name}" for offset, name in enumerate(references))
        parts.append(
            "The following images are references for materials and atmosphere. Use each one where its name "
            f"says, without copying its framing or its objects: {listed}."
        )
    parts += [MATERIALS, LIGHT, PHOTO_STYLE]
    if people:
        parts.append(PEOPLE)
    if brief:
        parts.append(
            "Project brief from the architect. Follow it; it takes priority over the default materials "
            f"and light above:\n{brief}"
        )
    parts.append(SINGLE_IMAGE)
    return "\n\n".join(parts)


# --- Upscale par régénération (fournisseur Gemini, qui n'a pas de modèle d'upscale) -------------

UPSCALE_PROMPT = "\n\n".join([
    "Reproduce image 1 exactly, at a higher resolution. Keep the composition, framing, perspective, every "
    "object, material, colour, light and shadow strictly identical. Only add the fine detail, texture and "
    "sharpness of a high-resolution photograph: no change, no addition, no removal, no new style.",
    SINGLE_IMAGE,
])


# --- Storyboard : plans cinématiques tirés de l'image maître ------------------------------------

@dataclass(frozen=True)
class Shot:
    title: str    # titre court en français, pour s'y retrouver
    image: str    # cadrage et contenu du plan (consigne pour l'image)
    motion: str   # mouvement de caméra et vie dans l'image (consigne pour la vidéo)


STORYBOARD_SYSTEM = (
    "You are a cinematographer and an interior photographer. You prepare short presentation films of "
    "interior design projects, shot with a Fujifilm camera. You answer with JSON only."
)

STORYBOARD_REQUEST = """Write a storyboard of {count} cinematic shots of the room in the attached image, shot with a Fujifilm camera.

Rules:
- Every shot shows THIS SAME room, with the same architecture, materials, furniture, light and time of day.
- Vary shot sizes and angles: a wide establishing shot, a medium shot, close-up details of materials or objects that are visible in the image, a side or reverse angle.
- Only show what exists in the image, or what plausibly continues it just outside the frame. Never invent or change furniture.
- Each shot will become a 5-second video clip: plan one slow, smooth camera movement per shot (dolly in or out, lateral slide, slow pan or tilt, gentle parallax) and subtle natural life (sunlight shimmer, leaves moving).

Answer with this JSON only:
{{"shots": [{{"title": "short title in French, 3 to 6 words", "image": "English description of the framing and of what is visible", "motion": "English description of the camera movement and of the subtle life in the shot"}}]}}"""

# Plans utilisés quand aucun modèle de texte n'est réglé (RENDU_MODELE_LLM=aucun).
DEFAULT_SHOTS = (
    Shot("Plan large d'ensemble",
         "wide establishing shot of the whole room from a corner, eye level, showing the main volumes and the windows",
         "slow dolly-in towards the centre of the room, eye level"),
    Shot("Plan moyen sur le coin salon",
         "medium shot of the main seating area, slightly lower camera height, foreground furniture gently framing the view",
         "slow lateral slide from left to right with gentle parallax between foreground and background"),
    Shot("Détail matière et lumière",
         "close-up detail of a material or object lit by the sunlight (floor, fabric, plant, shelf), shallow depth of field",
         "very slow push-in on the detail, sunlight stripes shimmering softly, leaves moving gently"),
    Shot("Contrechamp vers la fenêtre",
         "reverse angle looking towards the windows and the light, sunlight entering the room",
         "slow tilt up from the floor to the window, dust particles floating in the light"),
)


def storyboard_request(count: int) -> str:
    return STORYBOARD_REQUEST.format(count=count)


def shot_prompt(shot: Shot) -> str:
    """Consigne pour fabriquer l'image d'un plan à partir de l'image maître (image 1)."""
    return "\n\n".join([
        "Image 1 is the approved master photograph of an interior design project. Create another photograph "
        "of the SAME room, as if taken during the same photo shoot a few minutes later, for a cinematic "
        f"storyboard.\nShot: {shot.image}",
        "Keep exactly the same architecture, materials, furniture, artworks, colours, light direction, time of "
        "day and colour grading as image 1. Only show what exists in image 1, or what plausibly continues it "
        "just outside its frame; never change or add furniture.",
        PHOTO_STYLE,
        SINGLE_IMAGE,
    ])


def parse_storyboard(text: str, count: int) -> list[Shot]:
    """Lit la réponse JSON du modèle de texte (tolère un bloc ```json autour)."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("la réponse ne contient pas de JSON")
    data = json.loads(match.group(0))
    items = data.get("shots") if isinstance(data, dict) else None
    if not isinstance(items, list) or not items:
        raise ValueError("la réponse ne contient pas de liste « shots »")
    shots = []
    for item in items[:count]:
        if not isinstance(item, dict) or not str(item.get("image", "")).strip():
            raise ValueError(f"plan mal formé : {item!r}")
        shots.append(Shot(
            title=str(item.get("title", "")).strip() or f"Plan {len(shots) + 1}",
            image=str(item["image"]).strip(),
            motion=str(item.get("motion", "")).strip() or DEFAULT_MOTION,
        ))
    return shots


# --- Vidéo : animation d'une image ---------------------------------------------------------------

DEFAULT_MOTION = "slow dolly-in towards the centre of the room, eye level"

VIDEO_RULES = (
    "Cinematic interior video: slow, smooth, stabilised camera movement at constant speed, like a gimbal "
    "or a slider. The architecture, furniture and materials stay perfectly rigid and identical to the first "
    "frame: no morphing, no warping, nothing appearing or disappearing. Subtle natural life only: sunlight "
    "shimmering, leaves moving gently, dust floating in the light. Photorealistic, natural Fujifilm colour."
)

NEGATIVE_VIDEO = (
    "morphing, warping, bending walls, distorted furniture, flickering, objects appearing or disappearing, "
    "fast camera movement, shaky camera, text, watermark, blur, low quality"
)


def video_prompt(motion: str | None) -> str:
    return f"Camera: {motion or DEFAULT_MOTION}.\n\n{VIDEO_RULES}"
