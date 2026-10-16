"""La recette du rendu : consignes envoyées aux modèles, tirées de l'analyse des deux vidéos de référence.

Le look visé (première vidéo) : photo d'intérieur de magazine, fin d'après-midi, soleil bas qui passe à
travers les stores et dessine des rayures sur le parquet, spots allumés en blanc chaud, chêne naturel,
murs grège mats, rendu couleur Fujifilm, verticales droites.

Les consignes vidéo (deuxième vidéo) : ne jamais redécrire l'architecture, décrire seulement le mouvement
de caméra (vue FPV, vol traversant, travelling avant, très lent), son intensité et l'ambiance (calme et
contemplation, ou vent et dynamisme), et demander de garder strictement la géométrie.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

# --- Rendu photo à partir d'une capture 3D Archicad --------------------------------------------

# Consignes condensées : chaque mot est payé à chaque demande (et compte dans les quotas gratuits).

GEOMETRY_LOCK = (
    "Image 1 : capture de la maquette 3D Archicad, qui fait foi. Garde exactement le cadrage, la position de "
    "caméra et la focale, la géométrie (murs, plafonds, poutres, poteaux, baies, portes) et chaque meuble, "
    "luminaire, objet et tableau, à la même place, de même forme, taille et couleur. N'ajoute, ne retire et ne "
    "déplace rien. Ignore l'aspect du logiciel 3D : aplats gris, textures absentes, contours noirs, plantes et "
    "personnages en découpe 2D."
)

MATERIALS = (
    "Matériaux : rends chaque surface réelle, avec ses imperfections. Garde les matériaux et couleurs de la "
    "maquette (une texture bois devient le même bois). Surfaces grises ou sans texture : parquet chêne naturel "
    "satiné, murs grège mats, plafond blanc mat. Vrais tissus (bouclette, lin, cuir), métal, verre avec reflets, "
    "vraies plantes. Lieu habité mais rangé."
)

LIGHT = (
    "Lumière : fin d'après-midi, soleil bas et chaud ; à travers les stores, rayures nettes sur le sol et le "
    "mobilier ; lumière renvoyée douce ; spots et rails allumés en 2700 K, avec halos sur les murs ; fenêtres "
    "lumineuses sans être brûlées."
)

PHOTO_STYLE = (
    "Photo : magazine d'architecture, moyen format Fujifilm, couleurs Classic Chrome chaudes et légèrement "
    "désaturées, hautes lumières douces, grain très fin, verticales droites, textures nettes, aucun aspect image "
    "de synthèse ni HDR."
)

PEOPLE = (
    "Ajoute une ou deux personnes en tenue neutre, prises sur le vif, sans regarder l'objectif ni cacher "
    "l'architecture."
)

SINGLE_IMAGE = "Une seule photo, sans texte, filigrane, bordure ni montage."


def render_prompt(*, master: bool, references: list[str], brief: str | None, people: bool) -> str:
    """Consigne pour transformer la capture 3D (image 1) en photo.

    Ordre des images envoyées : capture, image maître (si `master`), puis références.
    `references` : nom de chaque photo de référence, qui dit à quoi elle sert.
    """
    parts = [GEOMETRY_LOCK]
    index = 2
    if master:
        parts.append(f"Image {index} : image maître validée. Reprends exactement ses matériaux, couleurs, lumière et "
                     "style, comme pour la même séance photo, mais pas son cadrage ni ses meubles.")
        index += 1
    if references:
        listed = " ; ".join(f"image {index + offset} : {name}" for offset, name in enumerate(references))
        parts.append(f"Références de matériaux et d'ambiance, à utiliser là où leur nom l'indique, sans copier leur "
                     f"cadrage : {listed}.")
    parts += [MATERIALS, LIGHT, PHOTO_STYLE]
    if people:
        parts.append(PEOPLE)
    if brief:
        parts.append(f"Consignes de l'architecte, prioritaires sur ce qui précède :\n{brief}")
    parts.append(SINGLE_IMAGE)
    return "\n\n".join(parts)


# --- Upscale par régénération (fournisseur Gemini, qui n'a pas de modèle d'upscale) -------------

UPSCALE_PROMPT = (
    "Reproduis l'image 1 à l'identique en plus haute définition : même cadrage, mêmes objets, matériaux, "
    "couleurs, lumières et ombres. Ajoute seulement finesse et netteté, sans rien changer.\n\n" + SINGLE_IMAGE
)


# --- Ambiances vidéo (deuxième vidéo : « du vent, du dynamisme, ou au contraire du calme ») -------

AMBIANCES = {
    "calme": "contemplation, haut de gamme, aucune agitation, mouvement extrêmement lent et posé",
    "dynamique": "un peu de vent dans la végétation et les tissus, mouvement de caméra plus franc, énergie d'une "
                 "ville vivante",
}
DEFAULT_AMBIANCE = "calme"

# Style du mouvement dans la consigne vidéo, selon l'ambiance.
VIDEO_STYLES = {
    "calme": "Caméra extrêmement lente, fluide, stabilisée, à vitesse constante ; seulement une vie discrète "
             "(reflets du soleil, feuilles qui bougent à peine).",
    "dynamique": "Caméra fluide et stabilisée, plus franche, avec de l'élan ; du vent dans la végétation et les "
                 "tissus, une vie visible mais naturelle.",
}


# --- Storyboard : plans cinématiques tirés d'une image ------------------------------------------

@dataclass(frozen=True)
class Shot:
    title: str    # titre court, pour s'y retrouver
    image: str    # cadrage et contenu du plan (consigne pour l'image)
    motion: str   # mouvement de caméra et vie dans l'image (consigne pour la vidéo)


STORYBOARD_SYSTEM = "Tu es directeur de la photographie spécialisé en architecture. Tu réponds en JSON, en français."

STORYBOARD_REQUEST = """Storyboard de {count} plans vidéo de 5 s du lieu de l'image.
- Même lieu, mêmes architecture, matériaux, mobilier et lumière ; n'invente rien.
- Varie les scènes : entrée, plan large, vol traversant en vue FPV, détail de matière, sortie, accéléré (timelapse) caméra fixe.
- « mouvement » : ne redécris pas l'architecture. Donne le mouvement de caméra (vue FPV, vol traversant, travelling avant ou arrière, glissement latéral, panoramique, élévation), sa vitesse et la vie discrète du plan, en une ou deux phrases.
- Ambiance : {name} ({ambiance}).{same_image}
JSON : {{"plans": [{{"titre": "3 à 6 mots"{image_field}, "mouvement": "..."}}]}}"""

# Plans utilisés quand aucun modèle de texte n'est réglé (RENDU_MODELE_LLM=aucun ou RENDU_GEMINI_MODELE_TEXTE=aucun).
DEFAULT_SHOTS = (
    Shot("Scène d'entrée",
         "plan large depuis l'entrée du lieu, à hauteur d'œil, avec les volumes principaux et les fenêtres",
         "travelling avant vers le cœur du lieu, à hauteur d'œil"),
    Shot("Vol traversant",
         "plan moyen à travers l'espace principal, caméra un peu plus basse, premier plan qui cadre la vue",
         "vol traversant en vue FPV qui glisse à travers l'espace, avec un léger effet de profondeur entre le "
         "premier plan et le fond"),
    Shot("Détail matière et lumière",
         "gros plan sur une matière ou un objet éclairé par le soleil, faible profondeur de champ",
         "approche douce vers le détail, la lumière joue sur la matière"),
    Shot("Scène de sortie",
         "contrechamp vers l'extérieur et la lumière",
         "travelling arrière qui s'élève doucement pour révéler l'ensemble"),
)


SAME_IMAGE_RULE = "\n- Tous les plans partent de cette image et de son cadrage : ne varie que le mouvement et la scène."


def storyboard_request(count: int, ambiance: str = DEFAULT_AMBIANCE, same_image: bool = False) -> str:
    """`same_image` : chaque plan sera animé à partir de l'image de départ elle-même, sans image par plan
    (le champ « image » est alors inutile : autant de tokens de réponse en moins)."""
    return STORYBOARD_REQUEST.format(count=count, name=ambiance, ambiance=AMBIANCES[ambiance],
                                     same_image=SAME_IMAGE_RULE if same_image else "",
                                     image_field="" if same_image else ', "image": "cadrage et contenu"')


def storyboard_schema(same_image: bool = False) -> dict:
    """Format de réponse imposé au modèle de texte (pas de JSON mal formé à redemander)."""
    fields = ["titre", "mouvement"] if same_image else ["titre", "image", "mouvement"]
    plan = {"type": "OBJECT", "properties": {name: {"type": "STRING"} for name in fields}, "required": fields}
    return {"type": "OBJECT", "properties": {"plans": {"type": "ARRAY", "items": plan}}, "required": ["plans"]}


def shot_prompt(shot: Shot) -> str:
    """Consigne pour fabriquer l'image d'un plan à partir de l'image de départ (image 1)."""
    return "\n\n".join([
        "Image 1 : photo validée du projet. Crée une autre photo du MÊME lieu, même séance quelques minutes plus "
        f"tard. Plan : {shot.image}",
        "Garde exactement architecture, matériaux, mobilier, couleurs, lumière et étalonnage ; ne montre que ce qui "
        "existe ou le prolonge juste hors du cadre.",
        PHOTO_STYLE,
        SINGLE_IMAGE,
    ])


def parse_storyboard(text: str, count: int) -> list[Shot]:
    """Lit la réponse JSON du modèle de texte (tolère un bloc ```json autour)."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("la réponse ne contient pas de JSON")
    data = json.loads(match.group(0))
    items = data.get("plans") if isinstance(data, dict) else None
    if not isinstance(items, list) or not items:
        raise ValueError("la réponse ne contient pas de liste « plans »")
    shots = []
    for item in items[:count]:
        if not isinstance(item, dict):
            raise ValueError(f"plan mal formé : {item!r}")
        image = str(item.get("image", "")).strip()
        motion = str(item.get("mouvement", "")).strip()
        if not image and not motion:
            raise ValueError(f"plan vide : {item!r}")
        shots.append(Shot(title=str(item.get("titre", "")).strip() or f"Plan {len(shots) + 1}",
                          image=image, motion=motion or DEFAULT_MOTION))
    return shots


# --- Vidéo : animation d'une image ---------------------------------------------------------------

DEFAULT_MOTION = "travelling avant vers le cœur du lieu, à hauteur d'œil"

VIDEO_RULES = (
    "Garde strictement la géométrie : architecture, mobilier et matériaux rigides et identiques à la première "
    "image, sans déformation ni apparition. Photoréaliste, couleurs Fujifilm. Aucun autre changement dans la scène."
)

NEGATIVE_VIDEO = (
    "déformation, morphing, murs qui se tordent, mobilier déformé, scintillement, objets qui apparaissent ou "
    "disparaissent, mouvement de caméra rapide, caméra qui tremble, texte, filigrane, flou, mauvaise qualité"
)


def video_prompt(motion: str | None, ambiance: str = DEFAULT_AMBIANCE) -> str:
    return f"Caméra : {motion or DEFAULT_MOTION}.\n{VIDEO_STYLES[ambiance]}\n{VIDEO_RULES}"
