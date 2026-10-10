# ABSE Plan & Métré — analyse et conception

## 1. Ce que montre la vidéo de référence (appli Visuary, « Tout part du plan »)

Démonstration filmée sur un salon professionnel : relevé d'une salle de bain d'exposition
avec un iPhone Pro, puis plan et métré générés automatiquement.

| Étape | Écran observé | Détails relevés |
|---|---|---|
| 1. Capture | Vue caméra, contours détectés en surimpression | Consignes (« Ralentissez »), bouton **Terminer la zone**, bouton photo |
| 2. Contrôle | Maquette 3D grise orientable | Murs, baignoire, meuble ; bouton **OK** |
| 3. Zones | Vignette de la zone capturée | **Ajouter une zone à la capture** / **Finaliser la capture** |
| 4. Import | Maquette + options | Niveau (« RDC »), « Surface sélectionnée », **Compter ouvrants**, « Activer l'import des sous-pentes (bêta) », **Sauvegarder et continuer** |
| 5. Plan | Plan 2D sur quadrillage | Sélecteur **Plan actuel ▾**, niveau **RDC ▾**, annuler/rétablir, enregistrer ; pièce « Salle de bain 3,57 m² » avec cotes en cm (187, 52, 137, 194, 188…) ; baignoire, vasque |
| 6. 3D | Vue 3D texturée | Faïence bleue, carrelage ; bascule 2D/3D dans la barre de droite |
| 7. Navigation | Barre du bas | **Photos** · aide · **Métré** ; pilule **← Plan rénové →** |
| 8. Métré | Onglets **Global / Par étage / Par pièce** | voir ci-dessous |

### Métré affiché et règles de calcul retrouvées

| Ligne | Valeur | Règle (vérifiée par le calcul) |
|---|---|---|
| Surfaces · Surface au sol | 3,57 m² | aire du contour intérieur (2,04 × 1,75) |
| Surfaces murs et cloisons · Cloison 98 mm | 18,95 m² | périmètre intérieur × hauteur = 7,58 × 2,50 |
| Surfaces à peindre (hors ouvrants) · Cloison 98 mm | 18,95 m² | murs − ouvertures |
| Surfaces à peindre · Plafond | 3,57 m² | = surface au sol |
| Volume | 8,93 m³ | 3,57 × 2,50 |
| Circonférences · Extérieure | 8,37 m | contour décalé de l'épaisseur des murs (7,58 + 8 × 0,098 ≈ 8,36) |
| Circonférences · Intérieure | 7,58 m | tour du contour intérieur |
| Circonférences · Plinthes | 7,58 m | intérieure − largeur des ouvertures au sol |
| Revêtements de sol · Carrelage beige vintage 25×25 | 2,36 m² | sol − emprise baignoire et meuble vasque (≈ 1,21 m²) |

Ces valeurs sont reproduites à l'identique par les tests (`src/metre/calcul.test.ts`).

## 2. Adaptation à Android

L'appli de référence s'appuie sur le LiDAR de l'iPhone Pro et la détection automatique d'Apple
(RoomPlan). Il n'existe pas d'équivalent sur Android : la plupart des téléphones n'ont pas de LiDAR
et ARCore ne reconnaît pas les pièces.

**Choix retenu :** appli web installable (PWA), avec trois façons de relever une pièce :

1. **Réalité augmentée (ARCore, via WebXR dans Chrome)** : on vise chaque angle de la pièce au pied
   du mur et on touche l'écran ; la hauteur se relève en visant la jonction mur/plafond ou se saisit.
   Plusieurs pièces relevées dans la même session gardent leur position relative.
   C'est la méthode de Magicplan sur Android.
2. **Saisie au mètre laser** : longueur de chaque côté et sens du virage (90° à gauche ou à droite,
   ou angle libre) ; la pièce se ferme automatiquement.
3. **Pièce rectangulaire** : longueur × largeur × hauteur.

Les relevés approximatifs (réalité augmentée) sont **orthogonalisés** : les angles proches de 90°
sont redressés (`orthogonaliser`).

Pourquoi une PWA plutôt qu'un APK natif :
- elle s'installe depuis Chrome (icône, plein écran, hors ligne) et se met à jour seule ;
- elle sert aussi sur le PC Windows du bureau pour reprendre les plans ;
- elle se compile et se teste entièrement sans Android Studio ;
- elle reste transformable plus tard en APK pour le Play Store (TWA via PWABuilder).

Données : stockées **sur l'appareil** (IndexedDB, stockage persistant demandé). Le transfert
téléphone ↔ PC et la sauvegarde se font par **export/import d'un fichier** de chantier (photos comprises).

## 3. Périmètre de la première version

- Chantiers (nom, client, adresse, notes) — liste, création, suppression, export/import.
- **Plusieurs niveaux** (Sous-sol, RDC, R+1…), hauteur sous plafond par défaut par niveau.
- **Plan actuel / plan rénové** par niveau : le plan rénové part d'une copie du plan actuel
  (mêmes identifiants de pièces, pour comparer et garder le lien avec les photos).
- Éditeur de plan 2D : pièces (polygones), murs typés par côté ou absents (séparation fictive),
  ouvertures (porte, porte-fenêtre, fenêtre, baie, passage), équipements (baignoire, douche,
  meuble vasque, WC…), cotes automatiques, aimantation, annuler/rétablir.
- Vue 3D orientable.
- **Photos de chantier** : prises avec l'appareil photo ou importées, rattachées au niveau / à la pièce,
  épinglées sur le plan, avec légende.
- **Métré type Visuary** : Global / Par étage / Par pièce, pour le plan actuel, le plan rénové, ou les
  deux en comparaison (écarts). Impression / PDF via le navigateur.

Hors périmètre v1 : sous-pentes, synchronisation en ligne, quantitatif plâtrerie, export Excel.

## 4. Architecture

```
src/
  model/        types.ts (contrat de données), catalogue.ts (valeurs par défaut), fabrique.ts
  geometrie/    polygone.ts (aire, décalage, découpe, orthogonalisation…), piece.ts (murs, ouvertures)
  metre/        calcul.ts (moteur de métré + présentation), tests
  store/        etat.ts (zustand : chantier ouvert, historique, enregistrement auto), persistance.ts (IndexedDB)
  ui/
    commun/     Icone, composants (Bouton, FeuilleBas, ChampNombre…), dialogues (confirmer, notifier)
    routeur.ts  navigation par ancre (#/chantier/<id>/metre…)
    EcranChantier.tsx  coque de l'écran plan (barres, niveaux, variantes, navigation)
    accueil/ plan/ plan3d/ capture/ metre/ photos/ parametres/   un dossier par module
```

### Conventions

- Code, identifiants et textes en **français** (comme le reste du dépôt).
- **Longueurs en cm** partout dans le modèle ; conversion en m / m² / m³ uniquement à l'affichage.
- Repère du plan : x vers la droite, y vers le bas. En 3D : (x, y) du plan → (x/100, 0, y/100) m, Y vertical.
- Toute modification passe par `useEtat.getState().modifierPlan(fn, { cle })` ou `modifierProjet` :
  `fn` modifie une copie ; `cle` regroupe un geste continu (glisser) en une seule étape d'annulation.
- Le plan affiché est `planCourant(etat)` ; le niveau, `niveauCourant(etat)`.
- Saisies numériques avec `ChampNombre` (virgule acceptée), cibles tactiles ≥ 44 px.
- Aucune ressource externe à l'exécution (hors ligne) : pas de CDN, pas de police distante.
