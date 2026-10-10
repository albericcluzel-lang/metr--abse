# ABSE Plan & Métré

Appli de relevé de pièces, plan 2D/3D et métré automatique, inspirée de Visuary (iPhone) et
adaptée aux téléphones **Android**. C'est une appli web installable (PWA) : elle s'installe depuis
Chrome comme une appli classique, fonctionne hors ligne et sert aussi sur PC.

- Analyse de l'appli de référence et choix de conception : [docs/analyse-et-conception.md](docs/analyse-et-conception.md)

## Ce que fait l'appli

1. **Relever une pièce** (bouton « + » en bas de l'écran du plan) :
   - en **réalité augmentée** (téléphone compatible ARCore) : on vise chaque angle au pied du mur, puis la
     jonction mur/plafond pour la hauteur ;
   - au **mètre laser** : on saisit chaque côté et le sens du virage, la pièce se ferme toute seule ;
   - en **pièce rectangulaire** : longueur × largeur × hauteur.
2. **Plan 2D / vue 3D** : cotes, murs (type et épaisseur par côté), portes, fenêtres, équipements
   (baignoire, douche, meuble vasque…), photos épinglées. Plusieurs **niveaux** (RDC, R+1…).
3. **Plan actuel / plan rénové** : le plan rénové part d'une copie de l'existant ; on y dessine le projet.
4. **Métré** (Global / Par étage / Par pièce) : surfaces au sol, murs et cloisons par type, surfaces à
   peindre hors ouvrants, plafonds, volume, périmètres intérieur / extérieur, plinthes, revêtements de sol,
   menuiseries. Comparaison actuel / rénové avec les écarts. Copie vers Excel, impression ou PDF.
5. **Photos de chantier** rattachées au niveau et à la pièce, épinglées sur le plan.

Les données restent **sur l'appareil**. Pour sauvegarder un chantier ou le passer du téléphone au PC :
Réglages du chantier → **Exporter** (fichier `.abse.json`, photos comprises), puis **Importer** sur l'autre appareil.

## Mise en ligne (une seule fois)

L'appli est publiée gratuitement par GitHub Pages à chaque mise à jour de la branche `main`.

1. Sur GitHub : **Settings → Pages → Build and deployment → Source : « GitHub Actions »**.
2. Fusionner la branche de développement dans `main` (ou lancer l'action « Appli Plan & Métré »
   à la main depuis l'onglet **Actions**).
3. L'appli est alors disponible à l'adresse : **https://albericcluzel-lang.github.io/metr--abse/**

## Installation

**Sur un téléphone Android**
1. Ouvrir l'adresse ci-dessus dans **Chrome**.
2. Menu **⋮ → Installer l'application** (ou le bouton « Installer » proposé par l'appli).
3. L'icône « ABSE Plan » apparaît sur l'écran d'accueil.

Pour la réalité augmentée, le téléphone doit être compatible ARCore et avoir l'appli
**« Services Google Play pour la réalité augmentée »** (Play Store). Sinon, le mètre laser et la saisie
rectangulaire restent disponibles.

**Sur PC Windows** : ouvrir l'adresse dans Chrome ou Edge, puis cliquer sur l'icône d'installation à droite
de la barre d'adresse.

Les mises à jour s'installent toutes seules à l'ouverture suivante.

## Développement

Prérequis : Node.js 22.

```bash
cd plan-metre
npm install
npm run dev          # serveur local : http://localhost:5173/metr--abse/
npm test             # tests du moteur de métré, de la géométrie et de l'état
npm run test:e2e     # tests dans le navigateur (téléphone Android émulé et PC)
npm run build        # version de production dans dist/
```

La réalité augmentée ne fonctionne qu'en **https** sur un vrai téléphone : pour l'essayer pendant le
développement, utiliser la version publiée sur GitHub Pages.
