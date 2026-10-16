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

GEOMETRY_LOCK = (
    "L'image 1 est une capture de la maquette 3D du projet (Archicad). Elle fait foi pour tout ce qui est "
    "construit. Garde exactement la même position de caméra, le même angle de vue, la même focale et le "
    "même cadrage ; la même géométrie des pièces, des murs, des hauteurs sous plafond, des poutres, des "
    "poteaux, des baies, des fenêtres et des portes ; et le même mobilier, les mêmes luminaires, objets et "
    "tableaux, aux mêmes endroits, avec les mêmes formes, tailles et couleurs. N'ajoute, ne retire, ne "
    "déplace et ne redimensionne aucun élément d'architecture ni aucun meuble. Ignore l'aspect du logiciel "
    "3D : surfaces grises unies, textures manquantes, arêtes trop nettes, contours noirs, plantes ou "
    "personnages en découpe 2D, éléments d'interface."
)

MATERIALS = (
    "Matériaux : transforme chaque surface en un vrai matériau, avec ses imperfections naturelles. Quand la "
    "maquette montre un matériau ou une couleur, garde-le et rends-le réel (une texture bois devient un vrai "
    "bois du même ton et du même dessin, un meuble coloré garde sa couleur). Quand une surface est grise ou "
    "sans texture, utilise : parquet en chêne naturel au veinage visible et à la finition satinée, murs "
    "peints grège chaud mat, plafond blanc mat. Vrais tissus (bouclette, laine, lin, cuir) avec plis et "
    "texture, métal laqué ou brossé, vrai verre avec reflets, vraies plantes aux feuilles naturelles. "
    "Décoration : lieu habité mais rangé (livres, vinyles, céramiques, plantes), sans encombrement."
)

LIGHT = (
    "Lumière : fin d'après-midi, soleil bas. La lumière chaude du soleil entre par les fenêtres et, là où il "
    "y a des stores, passe à travers en dessinant des rayures nettes sur le sol, le tapis et le mobilier. "
    "Une lumière chaude et douce, renvoyée par les surfaces, remplit la pièce. Les spots encastrés et les "
    "rails sont allumés, avec une lueur chaude de 2700 K et de légers halos sur les murs. Exposition "
    "équilibrée : les fenêtres sont lumineuses sans être brûlées."
)

PHOTO_STYLE = (
    "Photographie : photo d'architecture intérieure haut de gamme, comme publiée dans un magazine "
    "d'architecture. Appareil moyen format Fujifilm, couleurs naturelles Fujifilm proches de Classic "
    "Chrome : tons chauds, légèrement désaturés, naturels, hautes lumières douces, ombres profondes mais "
    "lisibles, grain très fin façon pellicule. Verticales parfaitement droites. Textures nettes et réalistes : "
    "aucun aspect image de synthèse, pas de sursaturation, pas de halos HDR."
)

PEOPLE = (
    "Personnages : ajoute une ou deux personnes en vêtements simples aux tons neutres, occupées "
    "naturellement (lire, marcher, regarder par la fenêtre), prises sur le vif sans regarder l'objectif. "
    "Elles ne doivent pas cacher les éléments d'architecture importants."
)

SINGLE_IMAGE = (
    "Produis une seule photographie : pas de texte, pas de légende, pas de filigrane, pas de bordure, pas "
    "d'écran partagé, pas de montage de plusieurs images."
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
            f"L'image {index} est l'image maître validée du projet : reprends exactement ses matériaux, sa "
            "palette de couleurs, sa lumière, sa balance des blancs et son style photographique, pour que "
            "toutes les images semblent venir de la même séance photo dans le même lieu. Prends-lui seulement "
            "son style, jamais son cadrage ni la disposition de ses meubles."
        )
        index += 1
    if references:
        listed = " ; ".join(f"image {index + offset} : {name}" for offset, name in enumerate(references))
        parts.append(
            "Les images suivantes sont des références de matériaux et d'ambiance. Utilise chacune là où son nom "
            f"l'indique, sans copier son cadrage ni ses objets : {listed}."
        )
    parts += [MATERIALS, LIGHT, PHOTO_STYLE]
    if people:
        parts.append(PEOPLE)
    if brief:
        parts.append(
            "Consignes de l'architecte pour ce projet. Respecte-les : elles passent avant les matériaux et la "
            f"lumière par défaut décrits plus haut.\n{brief}"
        )
    parts.append(SINGLE_IMAGE)
    return "\n\n".join(parts)


# --- Upscale par régénération (fournisseur Gemini, qui n'a pas de modèle d'upscale) -------------

UPSCALE_PROMPT = "\n\n".join([
    "Reproduis l'image 1 à l'identique, en plus haute définition. Garde strictement la même composition, le "
    "même cadrage, la même perspective, et chaque objet, matériau, couleur, lumière et ombre à l'identique. "
    "Ajoute seulement la finesse de détail, la texture et la netteté d'une photo haute définition : aucun "
    "changement, aucun ajout, aucune suppression, aucun nouveau style.",
    SINGLE_IMAGE,
])


# --- Ambiances vidéo (deuxième vidéo : « du vent, du dynamisme, ou au contraire du calme ») -------

AMBIANCES = {
    "calme": "contemplation, haut de gamme, aucune agitation, mouvement extrêmement lent et posé",
    "dynamique": "un peu de vent dans la végétation et les tissus, mouvement de caméra plus franc, énergie d'une "
                 "ville vivante",
}
DEFAULT_AMBIANCE = "calme"

# Style du mouvement dans la consigne vidéo, selon l'ambiance.
VIDEO_STYLES = {
    "calme": "Mouvement de caméra extrêmement lent, fluide et stabilisé, à vitesse constante, comme sur un "
             "stabilisateur ou un rail. Seulement une vie discrète et naturelle : reflets du soleil, feuilles qui "
             "bougent à peine.",
    "dynamique": "Mouvement de caméra fluide et stabilisé, plus franc, avec de l'élan, sans à-coups. Du vent fait "
                 "bouger la végétation et les tissus ; la vie autour du lieu est visible mais naturelle.",
}


# --- Storyboard : plans cinématiques tirés d'une image ------------------------------------------

@dataclass(frozen=True)
class Shot:
    title: str    # titre court, pour s'y retrouver
    image: str    # cadrage et contenu du plan (consigne pour l'image)
    motion: str   # mouvement de caméra et vie dans l'image (consigne pour la vidéo)


STORYBOARD_SYSTEM = (
    "Tu es directeur de la photographie et photographe d'architecture. Tu prépares de courts films de "
    "présentation de projets d'architecture et d'architecture intérieure, tournés avec un appareil Fujifilm. "
    "Tu réponds uniquement en JSON, et tous les textes de ta réponse sont en français."
)

STORYBOARD_REQUEST = """Écris un storyboard de {count} plans cinématiques du lieu visible sur l'image jointe.

Règles :
- Chaque plan montre CE MÊME lieu, avec la même architecture, les mêmes matériaux, le même mobilier, la même lumière et le même moment de la journée.
- Varie les types de plans : scène d'entrée (on s'approche ou on entre), plan large d'ensemble, vol traversant en vue FPV à travers l'espace, détails de matières ou d'objets visibles sur l'image, scène de sortie (on recule ou on s'élève), éventuellement un accéléré (timelapse) où la lumière évolue, caméra fixe.
- Ne montre que ce qui existe sur l'image, ou ce qui la prolonge de façon plausible juste hors du cadre. N'invente et ne modifie jamais de mobilier.
- Chaque plan deviendra un clip vidéo de 5 secondes. Pour la consigne de mouvement : NE REDÉCRIS PAS l'architecture (le modèle vidéo la voit déjà sur l'image). Décris seulement le mouvement de caméra avec des mots précis (vue FPV, vol traversant, travelling avant ou arrière, glissement latéral, panoramique, élévation, caméra fixe), sa vitesse et son intensité avec des adjectifs (extrêmement lent, posé, fluide, stabilisé), et la vie discrète dans le plan (reflets du soleil, feuilles qui bougent, passants). Termine par : « Garde strictement la géométrie, aucun autre changement dans la scène. »
- Ambiance voulue : {name} ({ambiance}).{same_image}

Réponds uniquement avec ce JSON :
{{"plans": [{{"titre": "titre court, 3 à 6 mots", "image": "description du cadrage et de ce qu'on voit", "mouvement": "consigne de mouvement pour la vidéo, comme décrit plus haut"}}]}}"""

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


SAME_IMAGE_RULE = (
    "\n- Tous les plans partent exactement de cette image, avec son cadrage : varie seulement le mouvement de "
    "caméra, son intensité et le type de scène. Le champ « image » rappelle simplement ce qu'on voit au départ."
)


def storyboard_request(count: int, ambiance: str = DEFAULT_AMBIANCE, same_image: bool = False) -> str:
    """`same_image` : chaque plan sera animé à partir de l'image de départ elle-même (pas d'image par plan)."""
    return STORYBOARD_REQUEST.format(count=count, name=ambiance, ambiance=AMBIANCES[ambiance],
                                     same_image=SAME_IMAGE_RULE if same_image else "")


def shot_prompt(shot: Shot) -> str:
    """Consigne pour fabriquer l'image d'un plan à partir de l'image de départ (image 1)."""
    return "\n\n".join([
        "L'image 1 est la photo validée d'un projet d'architecture. Crée une autre photo du MÊME lieu, comme "
        "prise pendant la même séance photo quelques minutes plus tard, pour un storyboard cinématique.\n"
        f"Plan : {shot.image}",
        "Garde exactement la même architecture, les mêmes matériaux, le même mobilier, les mêmes œuvres, les "
        "mêmes couleurs, la même direction de lumière, le même moment de la journée et le même étalonnage que "
        "l'image 1. Ne montre que ce qui existe sur l'image 1, ou ce qui la prolonge de façon plausible juste "
        "hors du cadre ; ne modifie ni n'ajoute jamais de mobilier.",
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
        if not isinstance(item, dict) or not str(item.get("image", "")).strip():
            raise ValueError(f"plan mal formé : {item!r}")
        shots.append(Shot(
            title=str(item.get("titre", "")).strip() or f"Plan {len(shots) + 1}",
            image=str(item["image"]).strip(),
            motion=str(item.get("mouvement", "")).strip() or DEFAULT_MOTION,
        ))
    return shots


# --- Vidéo : animation d'une image ---------------------------------------------------------------

DEFAULT_MOTION = "travelling avant vers le cœur du lieu, à hauteur d'œil"

VIDEO_RULES = (
    "Vidéo d'architecture cinématique. Garde strictement la géométrie : l'architecture, le mobilier et les "
    "matériaux restent parfaitement rigides et identiques à la première image, sans déformation, sans "
    "ondulation, sans rien qui apparaisse ou disparaisse. Rendu photoréaliste, couleurs naturelles Fujifilm. "
    "Aucun autre changement dans la scène."
)

NEGATIVE_VIDEO = (
    "déformation, morphing, murs qui se tordent, mobilier déformé, scintillement, objets qui apparaissent ou "
    "disparaissent, mouvement de caméra rapide, caméra qui tremble, texte, filigrane, flou, mauvaise qualité"
)


def video_prompt(motion: str | None, ambiance: str = DEFAULT_AMBIANCE) -> str:
    return (f"Caméra : {motion or DEFAULT_MOTION}.\n\nAmbiance {ambiance} : {AMBIANCES[ambiance]}.\n\n"
            f"{VIDEO_STYLES[ambiance]}\n\n{VIDEO_RULES}")
