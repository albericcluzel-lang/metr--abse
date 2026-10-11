# Rendus IA à partir d'Archicad

Ce programme reproduit le workflow d'une vidéo TikTok (compte @dlhio.g, « Tout ce workflow IA m'a pris 35 minutes ») : à partir de simples **captures de la fenêtre 3D d'Archicad**, il produit des **rendus photoréalistes cohérents entre eux**, un **storyboard** de plans cinématiques, des images **upscalées** et de **courtes vidéos animées**.

Tout passe par **fal.ai**, un service qui donne accès, avec une seule clé et un paiement à l'usage, aux modèles cités dans la vidéo : Nano Banana Pro (images), Kling et Seedance 2.0 (vidéo), Claude (texte).

Par défaut, chaque commande payante fonctionne en **simulation** : elle affiche ce qu'elle enverrait et combien de demandes seraient payées, sans rien envoyer. Il faut ajouter `--apply` pour lancer réellement.

## Ce que montre la vidéo (rétro-ingénierie)

### Les outils

| Élément | Ce qu'on voit dans la vidéo |
|---|---|
| Système nodal | **Freepik Spaces** : projet « Modern Interior Design Mockups », nœuds *Image Generator*, *Video Generator*, *Text*, *List*, *Image Upscaler*, *Assistant* |
| Modèles d'image | ChatGPT Image 2, **Nano Banana Pro** (Google) |
| Modèles vidéo | **Kling**, **Seedance 2.0** (ByteDance) |
| Modèle de texte (LLM) | « j'utilise Claude, mais choisis le LLM de ton choix » ; à l'écran, le nœud *Assistant* tourne sur GPT-5.6 Terra |
| Image de départ | capture d'une maquette 3D grise, non rendue : mobilier en place, plantes en découpe 2D, affiches, luminaires, ombres simples |

### Les étapes, dans l'ordre

1. **Injecter les références de matériaux et d'ambiance** dans le système nodal (vers 0:38). À l'écran : une photo de parquet chêne en point de Hongrie reliée au générateur d'images.
2. **Sortir plusieurs images** à partir des captures 3D pour présenter au client et valider la direction et le concept (0:43 à 0:51). L'auteur insiste : pas besoin de passer la nuit sur Twinmotion.
3. **Verrouiller l'image maître** (0:56) : c'est elle qui sert de référence pour générer toutes les autres, d'où la cohérence entre les vues.
4. **Storyboard** (1:02 à 1:11) : le nœud *Assistant* reçoit l'image maître avec la consigne « storyboard de 4 shot cinématique de l'image, caméra fujifilm ». Le résultat est exporté sous forme de liste, et chaque élément de la liste alimente un générateur d'images.
5. **Upscale** (1:12) : nœud *Image Upscaler*, qui correspond à Magnific chez Freepik.
6. **Animer puis livrer** (1:13) : chaque plan est animé avec Kling ou Seedance, puis le tout est monté.

### Le « look » décrypté

| | Ce qu'on voit sur les rendus |
|---|---|
| Lumière | fin d'après-midi, soleil bas qui traverse les stores et dessine des **rayures de lumière** sur le parquet et le mobilier ; spots encastrés et rails allumés en blanc chaud, avec des halos sur les murs |
| Matériaux | chêne naturel (lames larges ou point de Hongrie), murs grège mats, plafond blanc avec poutres, bouclette, cuir, laine, métal laqué noir, verre |
| Mobilier et déco | esprit années 50-60 (suspension Serge Mouille, chauffeuse en bouclette, buffet jaune type USM, pouf en cuir, tapis kilim), figuier lyre et monstera dans un panier en fil noir, vinyles, affiches encadrées |
| Photo | rendu couleur **Fujifilm**, tons chauds un peu désaturés, grain fin, **verticales droites**, format **vertical 9:16** ; certains plans avec 1 ou 2 personnes en situation |
| Vidéo | mouvements de caméra lents et fluides (travelling avant, glissé latéral), le décor reste parfaitement stable |

Ce look est écrit dans [`rendu_ia/prompts.py`](rendu_ia/prompts.py), avec la consigne la plus importante : **garder exactement la géométrie, le cadrage et le mobilier de la capture Archicad**, et ne changer que l'aspect des matériaux et de la lumière.

### Correspondance avec ce programme

| Dans la vidéo (Freepik Spaces) | Ici |
|---|---|
| Nœud de références + générateurs d'images | dossier `references` + commande `essais` |
| Choix et verrouillage de l'image maître | commande `maitre` |
| Les autres vues, dans le style de l'image maître | commande `rendus` |
| Nœud *Assistant* + liste + générateurs | commande `storyboard` |
| Nœud *Image Upscaler* | commande `upscale` |
| Nœud *Video Generator* (Kling, Seedance) | commande `video` |

## Avant de commencer

**Coût.** Ordre de grandeur relevé en octobre 2026, à vérifier sur <https://fal.ai/pricing> :

| Étape | Modèle par défaut | Prix indicatif |
|---|---|---|
| essais, rendus, plans du storyboard | Nano Banana Pro en 2K | 0,15 à 0,20 $ par image (4K : environ le double) |
| écriture du storyboard | Claude Sonnet 5.5 | environ 0,01 $ |
| upscale | SeedVR2 | quelques centimes par image |
| vidéo | Kling 3 Pro, sans son | environ 0,11 $ par seconde, soit 0,55 $ pour 5 s |
| vidéo (option) | Seedance 2.0 en 720p | environ 0,30 $ par seconde, soit 1,50 $ pour 5 s |

Pour un projet type (6 vues, 4 essais, 4 plans, 4 vidéos de 5 s avec Kling), comptez **environ 5 $**. Un travail déjà fait n'est pas repayé : relancer une commande ne produit que ce qui manque, ou ce dont l'image de départ a changé depuis (capture réexportée, nouvelle image maître, rendu refait).

**Confidentialité.** Les captures et les références partent chez fal.ai (États-Unis), qui les transmet aux éditeurs des modèles (Google, Kuaishou pour Kling, ByteDance pour Seedance, Anthropic). Pour un projet confidentiel, faites valider l'usage par le client ou l'employeur, et ouvrez le compte au nom de l'entreprise.

**Limites.** Les images sont des **perspectives d'ambiance, non contractuelles**. Même avec la consigne de tout garder, l'IA peut déplacer une menuiserie, changer une proportion ou inventer un détail : vérifiez chaque image avant de la montrer, et refaites celles qui s'écartent du projet.

## Mise en place

### 1. Créer la clé fal.ai

1. Créez un compte sur <https://fal.ai> (au nom de l'entreprise si possible).
2. Ajoutez du crédit dans *Billing* : 10 $ suffisent pour plusieurs projets.
3. Créez une clé dans *API Keys* et copiez-la.

### 2. Installer

Il faut Python 3.10 ou plus. Depuis le dossier `rendu-ia` :

```
python -m venv .venv
.venv\Scripts\activate            # Windows   (Mac/Linux : source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env            # Windows   (Mac/Linux : cp .env.example .env)
```

Ouvrez `.env` et collez la clé après `FAL_KEY=`. Les autres réglages sont facultatifs.

### 3. Créer un projet

```
python -m rendu_ia nouveau "C:\Projets\Appartement Arceaux"
```

Le dossier créé contient :

```
Appartement Arceaux\
  captures\       vos vues 3D Archicad, une image par point de vue
  references\     photos de matériaux et d'ambiance, nommées par leur usage
  ambiance.txt    l'ambiance voulue, en quelques lignes (facultatif)
```

## Préparer les captures dans Archicad

L'IA garde ce qu'elle voit sur la capture : plus la maquette est précise, plus le rendu est fidèle. Les noms de menus ci-dessous peuvent varier selon la version d'Archicad.

- **Meublez la maquette** avec de vrais objets (canapé, luminaires, tapis, plantes, cadres), comme dans la vidéo. Une pièce vide reste vide.
- **Matériaux** : les surfaces auxquelles vous donnez une texture ou une couleur dans Archicad sont respectées (un bois reste ce bois, un meuble jaune reste jaune). Les surfaces laissées grises prennent l'ambiance par défaut : chêne naturel, murs grège, plafond blanc.
- **Affichage 3D** : moteur OpenGL, textures activées, **ombres du soleil activées** (elles indiquent à l'IA d'où vient la lumière), contours désactivés ou fins.
- **Caméra** : hauteur d'œil (1,40 à 1,60 m), caméra bien horizontale (cible à la même hauteur que l'œil) pour garder des **verticales droites**, angle de vue large (60 à 75°, l'équivalent d'un 24 mm).
- **Cadrage** : vertical (par exemple 1152 × 2048 pixels) pour un rendu comme la vidéo, ou horizontal pour une présentation. Au moins 1 000 pixels sur le petit côté.
- **Export** : fenêtre 3D active, *Fichier > Enregistrer sous* au format PNG, ou une simple capture d'écran (Windows + Maj + S) de la fenêtre 3D agrandie.
- Une image par point de vue : 4 à 8 vues suffisent pour présenter un logement.

**Références** : déposez dans `references` des photos de matériaux ou d'ambiance (parquet, tissu, carrelage, photo d'un intérieur qui vous plaît), **nommées par leur usage**, car le nom du fichier est transmis à l'IA : `sol - parquet chene point de hongrie.jpg`, `canape - tissu bouclette ecru.jpg`, `ambiance - salon annees 60.jpg`. 12 références au plus.

**Ambiance** : écrivez dans `ambiance.txt` ce qui doit changer par rapport au look par défaut, en français : « Lumière du matin, ciel couvert », « Murs blanc cassé, touches de terracotta », etc.

## Utilisation, étape par étape

Chaque commande s'arrête en simulation : relisez ce qu'elle annonce, puis relancez-la avec `--apply`.

Une image est refaite automatiquement quand son image de départ est plus récente qu'elle : capture réexportée d'Archicad, nouvelle image maître (toutes les vues et le storyboard sont alors à refaire), rendu refait (son upscale et sa vidéo suivent). Après un changement de `ambiance.txt` ou des références, ajoutez `--refaire` pour tout reprendre.

Les exemples utilisent le projet `"C:\Projets\Appartement Arceaux"`, abrégé ici en `PROJET`.

### Étape 1 : essais d'une vue, pour valider la direction

```
python -m rendu_ia essais PROJET --capture salon
python -m rendu_ia essais PROJET --capture salon --apply
```

Quatre propositions de la vue `captures\salon.png` arrivent dans `sorties\essais` (`--nombre 2` pour en avoir moins). Ajoutez `--personnages` pour avoir une ou deux personnes dans l'image. Si aucune ne convient, ajustez `ambiance.txt` ou les références et relancez avec `--refaire`.

### Étape 2 : verrouiller l'image maître

```
python -m rendu_ia maitre PROJET "C:\Projets\Appartement Arceaux\sorties\essais\salon_3.png"
```

Gratuit. L'image choisie devient `sorties\maitre.png` et sert de référence de style pour tout le reste. Si elle vient des essais, elle devient aussi le rendu de sa vue, qui n'est donc pas repayé à l'étape 3.

### Étape 3 : rendus de toutes les vues

```
python -m rendu_ia rendus PROJET --apply
```

Chaque capture est rendue avec l'image maître et les références : les vues ont les mêmes matériaux, la même lumière et le même étalonnage. Résultats dans `sorties\rendus`. Options : `--capture cuisine` pour une seule vue, `--variantes 2` pour deux propositions par vue.

### Étape 4 : storyboard

```
python -m rendu_ia storyboard PROJET --apply
```

Le modèle de texte regarde l'image maître et écrit 4 plans cinématiques (plan large, plan moyen, détails, contrechamp), chacun avec son mouvement de caméra. Le storyboard est enregistré dans `sorties\storyboard\maitre\storyboard.json`, et les images des plans à côté (`plan_1.png`...). Options : `--plans 6`, `--image <autre rendu>` pour partir d'une autre image.

### Étape 5 : upscale

```
python -m rendu_ia upscale PROJET --apply
```

Agrandit ×2 les rendus et les plans du storyboard, dans `sorties\upscale`. Vous pouvez aussi donner des fichiers précis à la suite du projet.

### Étape 6 : vidéos

```
python -m rendu_ia video PROJET --apply
```

Anime chaque plan du storyboard (la version upscalée si elle existe) avec le mouvement prévu, en 5 secondes, dans `sorties\videos`. Sans storyboard, ce sont les rendus qui sont animés. Options : `--modele seedance`, `--duree 8`, `--mouvement "slow lateral slide from left to right"` (en anglais) pour imposer un mouvement.

Il reste à monter les clips (Clipchamp, fourni avec Windows, CapCut, Premiere...).

### Ce que contient le dossier `sorties`

```
sorties\
  essais\        propositions de l'étape 1
  maitre.png     image maître
  rendus\        une image par vue
  storyboard\    storyboard.json et images des plans
  upscale\       images agrandies
  videos\        clips MP4
```

## Réglages (fichier `.env`)

| Réglage | Par défaut | Rôle |
|---|---|---|
| `FAL_KEY` | | clé fal.ai, obligatoire pour `--apply` |
| `RENDU_RESOLUTION` | `2K` | `1K`, `2K` ou `4K` |
| `RENDU_FORMAT` | `auto` | format des images ; `auto` garde celui de la capture |
| `RENDU_MODELE_IMAGE` | `fal-ai/nano-banana-pro/edit` | modèle d'image |
| `RENDU_MODELE_LLM` | `anthropic/claude-sonnet-5.5` | modèle qui écrit le storyboard ; `aucun` pour 4 plans types |
| `RENDU_MODELE_UPSCALE` | `fal-ai/seedvr/upscale/image` | modèle d'upscale |
| `RENDU_FACTEUR_UPSCALE` | `2` | agrandissement, de 1 à 4 |
| `RENDU_MODELE_VIDEO` | `kling` | `kling` (3 à 15 s) ou `seedance` (4 à 15 s) |
| `RENDU_DUREE_VIDEO` | `5` | durée de chaque clip, en secondes |
| `RENDU_PARALLELE` | `3` | demandes envoyées en même temps |

Réglages avancés, si fal.ai fait évoluer ses modèles : `RENDU_ENDPOINT_VIDEO` (nouvelle version d'un modèle vidéo) et `RENDU_OPTIONS_IMAGE`, `RENDU_OPTIONS_UPSCALE`, `RENDU_OPTIONS_VIDEO`, des paramètres ajoutés tels quels aux demandes, au format JSON (voir l'onglet *API* de la page du modèle sur fal.ai).

## En cas de problème

- **« FAL_KEY manquante »** : la clé n'est pas dans `.env`, ou `.env` n'est pas dans le dossier `rendu-ia`.
- **« fal.ai refuse la demande : clé invalide ou crédit épuisé »** : vérifiez la clé et le crédit sur fal.ai. Le passage s'arrête pour ne rien envoyer d'autre.
- **« refusé par fal.ai (422) »** : un paramètre a été refusé ou l'image a été bloquée par le filtre du modèle. Le message de fal.ai suit. Si un modèle a changé ses paramètres, ajustez `RENDU_OPTIONS_*`.
- **Un rendu s'écarte de la maquette** : refaites-le (`rendus PROJET --capture salon --refaire --apply`), retirez les références qui ne concernent pas cette vue, ou précisez `ambiance.txt`.
- **« storyboard illisible »** : le modèle de texte n'a pas répondu au bon format. Relancez, ou utilisez les plans types (`RENDU_MODELE_LLM=aucun`).
- **Des échecs isolés** : relancez la même commande, seuls les manquants sont refaits.

## État des vérifications

Le programme est couvert par des tests automatiques, qui simulent les réponses de fal.ai. Les noms des modèles et de leurs paramètres viennent de la documentation de fal.ai consultée en octobre 2026, mais aucun appel réel n'a encore été fait. Pour le premier essai, limitez la dépense : `essais PROJET --capture salon --nombre 1 --apply`.

Pour lancer les tests :

```
pip install -r requirements-dev.txt
python -m pytest
```
