// Construction de la maquette 3D d'un plan (sans WebGL : testable et réutilisable,
// par exemple pour un aperçu après un relevé).
//
//   const groupe = construireGroupePlan(plan, catalogue);
//   scene.add(groupe);
//   …
//   libererGroupe(groupe); // libère géométries et matériaux
//
// Repère : point (x, y) du plan en cm → (x / 100, hauteur / 100, y / 100) en m,
// axe Y vertical (cf. repere.ts).
//
// Contenu, par pièce (Group nommé « piece », userData.pieceId) :
//  - « sol »        : contour intérieur à la couleur du revêtement ;
//  - « murs »       : un prisme par côté avec mur, entre le nu intérieur et le
//                     contour extérieur (angles en onglet), percé par les
//                     ouvertures de la pièce et celles des pièces voisines qui
//                     traversent le même mur ; dessus des murs plus foncé ;
//  - « aretes »     : arêtes vives des murs ;
//  - « cadres », « vitrages », « vantaux » : menuiseries ;
//  - un maillage « equipement » par équipement.
// Pas de plafond : on regarde la pièce par-dessus.

import {
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { hauteurEffective, segmentOuverture, trouverTypeMur, typeMurIdCote } from '../../geometrie/piece';
import { aire, aireSignee, decalerVersExterieur, distance, normaleExterieure, pointEtiquette, suivant } from '../../geometrie/polygone';
import { formaterValeur, percementsPropres, percementsVoisins } from '../../metre/calcul';
import type { Catalogue, Ouverture, Piece, Plan, Point } from '../../model/types';
import { construireVolumeEquipement } from './equipements';
import { aireMur, classerBord, couperBande, grilleMur, trapezeMur, type PointMur } from './murs';
import { versScene, type Point3 } from './repere';
import { fusionner, normaleBord, Tampon, VERS_LE_BAS, VERS_LE_HAUT } from './tampon';

/** Couleurs douces, proches de l'appli de référence. */
export const COULEURS_3D = {
  fond: '#f3f4fa',
  murs: '#f7f8fb',
  dessusMurs: '#b4b9ca',
  aretes: '#7a8199',
  solParDefaut: '#efece5',
  cadres: '#ffffff',
  vitrage: '#a2cdf1',
  bois: '#b9895a',
  equipement: '#fcfcfd',
  detail: '#d2d7e3',
} as const;

/** Épaisseur prise pour un mur dont le type n'est plus au catalogue (cm). */
const EPAISSEUR_INCONNUE = 10;
/** Angle d'entrebâillement des portes (degrés). */
const ANGLE_PORTE = 32;

/** Épaisseur du mur du côté i pour la 3D : 0 sans mur. */
export function epaisseurMur3D(piece: Piece, i: number, catalogue: Catalogue): number {
  const id = typeMurIdCote(piece, i);
  if (id === null) return 0;
  const e = trouverTypeMur(catalogue, id)?.epaisseur ?? 0;
  return e > 0 ? e : EPAISSEUR_INCONNUE;
}

interface Materiaux {
  murs: MeshLambertMaterial;
  dessus: MeshLambertMaterial;
  aretes: LineBasicMaterial;
  cadres: MeshLambertMaterial;
  vitrage: MeshLambertMaterial;
  bois: MeshLambertMaterial;
  equipement: MeshLambertMaterial;
  detail: MeshLambertMaterial;
  sol(couleur: string): MeshLambertMaterial;
}

function creerMateriaux(): Materiaux {
  // Décalage de profondeur des faces : les arêtes restent nettes par-dessus.
  const opaque = (color: string) =>
    new MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const sols = new Map<string, MeshLambertMaterial>();
  return {
    murs: opaque(COULEURS_3D.murs),
    dessus: opaque(COULEURS_3D.dessusMurs),
    aretes: new LineBasicMaterial({ color: COULEURS_3D.aretes }),
    cadres: opaque(COULEURS_3D.cadres),
    vitrage: new MeshLambertMaterial({ color: COULEURS_3D.vitrage, transparent: true, opacity: 0.42, depthWrite: false }),
    bois: opaque(COULEURS_3D.bois),
    equipement: opaque(COULEURS_3D.equipement),
    detail: opaque(COULEURS_3D.detail),
    sol(couleur) {
      let m = sols.get(couleur);
      if (!m) {
        m = opaque(couleur);
        sols.set(couleur, m);
      }
      return m;
    },
  };
}

function maillage(nom: string, geo: BufferGeometry, materiau: Material | Material[]): Mesh {
  const m = new Mesh(geo, materiau);
  m.name = nom;
  return m;
}

function aretes(nom: string, geo: BufferGeometry, materiau: LineBasicMaterial, angle: number): LineSegments {
  const l = new LineSegments(new EdgesGeometry(geo, angle), materiau);
  l.name = nom;
  return l;
}

/** Maquette 3D du plan, prête à ajouter à une scène three.js. */
export function construireGroupePlan(plan: Plan, catalogue: Catalogue): Group {
  const groupe = new Group();
  groupe.name = 'plan';
  const mat = creerMateriaux();
  for (const piece of plan.pieces) {
    const g = construirePiece(piece, plan, catalogue, mat);
    if (g) groupe.add(g);
  }
  // Les matériaux non utilisés (aucune fenêtre, etc.) sont libérés tout de suite.
  const utilises = new Set<Material>();
  groupe.traverse((o) => {
    const m = (o as Mesh).material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => utilises.add(x));
  });
  for (const m of [mat.murs, mat.dessus, mat.aretes, mat.cadres, mat.vitrage, mat.bois, mat.equipement, mat.detail]) {
    if (!utilises.has(m)) m.dispose();
  }
  return groupe;
}

/** Libère les géométries et matériaux d'un groupe construit par `construireGroupePlan`. */
export function libererGroupe(objet: Object3D): void {
  const materiaux = new Set<Material>();
  objet.traverse((o) => {
    const porteur = o as Partial<Mesh>;
    porteur.geometry?.dispose();
    const m = porteur.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => materiaux.add(x));
  });
  materiaux.forEach((m) => m.dispose());
  objet.removeFromParent();
}

function construirePiece(piece: Piece, plan: Plan, catalogue: Catalogue, mat: Materiaux): Group | null {
  if (piece.sommets.length < 3 || aire(piece.sommets) < 1) return null;
  const g = new Group();
  g.name = 'piece';
  g.userData = { pieceId: piece.id, nom: piece.nom };

  // Sol
  const sol = new Tampon();
  sol.faceHorizontale(piece.sommets, [], 0, VERS_LE_HAUT);
  const couleur = catalogue.revetementsSol.find((r) => r.id === piece.revetementSolId)?.couleur ?? COULEURS_3D.solParDefaut;
  g.add(maillage('sol', sol.geometrie(), mat.sol(couleur)));

  // Murs
  const faces = new Tampon();
  const dessus = new Tampon();
  construireMurs(piece, plan, catalogue, faces, dessus);
  if (!faces.vide || !dessus.vide) {
    const geo = fusionner([faces, dessus]);
    g.add(maillage('murs', geo, [mat.murs, mat.dessus]));
    g.add(aretes('aretes', geo, mat.aretes, 20));
  }

  // Menuiseries
  const cadres = new Tampon();
  const vitrages = new Tampon();
  const vantaux = new Tampon();
  for (const o of piece.ouvertures) construireMenuiserie(piece, o, catalogue, cadres, vitrages, vantaux);
  if (!cadres.vide) g.add(maillage('cadres', cadres.geometrie(), mat.cadres));
  if (!vantaux.vide) g.add(maillage('vantaux', vantaux.geometrie(), mat.bois));
  if (!cadres.vide || !vantaux.vide) g.add(aretes('aretes-menuiseries', fusionner([cadres, vantaux]), mat.aretes, 30));
  if (!vitrages.vide) {
    const v = maillage('vitrages', vitrages.geometrie(), mat.vitrage);
    v.renderOrder = 1;
    g.add(v);
  }

  // Équipements
  for (const e of piece.equipements) {
    const corps = new Tampon();
    const detail = new Tampon();
    construireVolumeEquipement(e, corps, detail);
    if (corps.vide && detail.vide) continue;
    const geo = fusionner([corps, detail]);
    const m = maillage('equipement', geo, [mat.equipement, mat.detail]);
    m.userData = { equipementId: e.id, type: e.type };
    m.add(aretes('aretes-equipement', geo, mat.aretes, 30));
    g.add(m);
  }
  return g;
}

/**
 * Faces des murs de la pièce. Chaque côté est quadrillé (cf. murs.ts) ; seules
 * les faces visibles sont produites : nus intérieur et extérieur, dessus,
 * tableaux, appuis et sous-faces de linteaux, et bouts de mur libres (côté
 * voisin sans mur). Les cellules voisines partagent exactement leurs sommets,
 * ce qui évite toute arête parasite sur les faces planes.
 */
function construireMurs(piece: Piece, plan: Plan, catalogue: Catalogue, faces: Tampon, dessus: Tampon): void {
  const pts = piece.sommets;
  const n = pts.length;
  const H = piece.hauteur;
  if (H <= 0) return;
  const epaisseurs = pts.map((_, i) => epaisseurMur3D(piece, i, catalogue));
  // Même calcul que contourExterieur(), avec une épaisseur de repli pour un type de mur inconnu.
  const ext = decalerVersExterieur(pts, epaisseurs);
  const percements = [...percementsPropres(piece), ...percementsVoisins(piece, plan, catalogue)];

  for (let i = 0; i < n; i++) {
    if (epaisseurs[i] <= 0) continue;
    const P = pts[i];
    const P1 = suivant(pts, i);
    const L = distance(P, P1);
    if (L < 0.5) continue;
    const u = { x: (P1.x - P.x) / L, y: (P1.y - P.y) / L };
    const nrm = normaleExterieure(pts, i);
    const Q = ext[i];
    const Q1 = ext[(i + 1) % n];
    const local = (X: Point): PointMur => ({
      s: (X.x - P.x) * u.x + (X.y - P.y) * u.y,
      t: (X.x - P.x) * nrm.x + (X.y - P.y) * nrm.y,
    });
    const lq = local(Q);
    const lq1 = local(Q1);
    if (lq1.s - lq.s < 0.5 || lq.t <= 0.01 || lq1.t <= 0.01) continue; // côté dégénéré
    const trapeze = trapezeMur(L, lq, lq1);
    const origines = [P, P1, Q1, Q];
    const monde = (p: PointMur): Point =>
      p.origine !== undefined ? origines[p.origine] : { x: P.x + u.x * p.s + nrm.x * p.t, y: P.y + u.y * p.s + nrm.y * p.t };

    const g = grilleMur(lq.s, lq1.s, L, H, percements.filter((p) => p.cote === i));
    const debutLibre = epaisseurs[(i - 1 + n) % n] <= 0;
    const finLibre = epaisseurs[(i + 1) % n] <= 0;
    const nc = g.colonnes.length - 1;
    const nb = g.bandes.length - 1;

    for (let c = 0; c < nc; c++) {
      const sMin = g.colonnes[c];
      const sMax = g.colonnes[c + 1];
      const emprise = couperBande(trapeze, sMin, sMax);
      if (emprise.length < 3 || Math.abs(aireMur(emprise)) < 1e-4) continue;
      const empriseMonde = emprise.map(monde);
      const sens = aireSignee(empriseMonde) >= 0 ? 1 : -1;
      const bords = emprise.map((a, k) => classerBord(a, emprise[(k + 1) % emprise.length], sMin, sMax, trapeze));

      for (let b = 0; b < nb; b++) {
        if (!g.plein[c][b]) continue;
        const z0 = g.bandes[b];
        const z1 = g.bandes[b + 1];
        for (let k = 0; k < emprise.length; k++) {
          const pa = empriseMonde[k];
          const pb = empriseMonde[(k + 1) % emprise.length];
          if (distance(pa, pb) < 1e-6) continue;
          const bord = bords[k];
          const visible =
            bord === 'interieur' ||
            bord === 'exterieur' ||
            (bord === 'debut' && debutLibre) ||
            (bord === 'fin' && finLibre) ||
            (bord === 'gauche' && (c === 0 ? debutLibre : !g.plein[c - 1][b])) ||
            (bord === 'droite' && (c === nc - 1 ? finLibre : !g.plein[c + 1][b]));
          if (visible) faces.paroi(pa, pb, z0, z1, normaleBord(pa, pb, sens));
        }
        if (b === nb - 1) dessus.polygone(empriseMonde.map((p) => versScene(p, z1)), VERS_LE_HAUT);
        else if (!g.plein[c][b + 1]) faces.polygone(empriseMonde.map((p) => versScene(p, z1)), VERS_LE_HAUT);
        if (b > 0 && !g.plein[c][b - 1]) faces.polygone(empriseMonde.map((p) => versScene(p, z0)), VERS_LE_BAS);
      }
    }
  }
}

/**
 * Menuiserie d'une ouverture : vantail en bois entrouvert pour une porte ;
 * cadre et vitrage bleuté (au milieu de l'épaisseur du mur) pour une fenêtre,
 * une porte-fenêtre ou une baie. Rien pour un passage libre.
 */
function construireMenuiserie(
  piece: Piece,
  o: Ouverture,
  catalogue: Catalogue,
  cadres: Tampon,
  vitrages: Tampon,
  vantaux: Tampon,
): void {
  if (o.type === 'passage') return;
  const seg = segmentOuverture(piece, o);
  if (!seg) return;
  const largeur = seg.fin - seg.debut;
  const h = hauteurEffective(piece, o);
  if (largeur < 4 || h < 4) return;
  const z0 = Math.max(0, o.allege);
  const z1 = z0 + h;
  const e = epaisseurMur3D(piece, o.cote, catalogue);
  const P = piece.sommets[o.cote];
  const u = { x: (seg.b.x - seg.a.x) / largeur, y: (seg.b.y - seg.a.y) / largeur };
  const nrm = normaleExterieure(piece.sommets, o.cote);
  const point = (s: number, t: number): Point => ({ x: P.x + u.x * s + nrm.x * t, y: P.y + u.y * s + nrm.y * t });
  const rect = (s0: number, s1: number, t0: number, t1: number) => [point(s0, t0), point(s1, t0), point(s1, t1), point(s0, t1)];

  if (o.type === 'porte') {
    // Vantail de 4 cm, entrouvert vers l'intérieur (ou l'extérieur) de la pièce.
    const epaisseurVantail = 4;
    const versInterieur = o.versInterieur !== false;
    const sensT = versInterieur ? -1 : 1;
    const tCharniere = versInterieur ? 0 : e;
    const charniereDebut = o.charniere !== 'fin';
    const sensS = charniereDebut ? 1 : -1;
    const sCharniere = (charniereDebut ? seg.debut : seg.fin) + sensS * 0.5;
    const a = (ANGLE_PORTE * Math.PI) / 180;
    const d = { s: sensS * Math.cos(a), t: sensT * Math.sin(a) };
    // Épaisseur du vantail du côté du mur (opposé au sens d'ouverture).
    let q = { s: -d.t, t: d.s };
    if (q.t * sensT > 0) q = { s: d.t, t: -d.s };
    const w = largeur - 1;
    const coins = [
      { s: sCharniere, t: tCharniere },
      { s: sCharniere + d.s * w, t: tCharniere + d.t * w },
      { s: sCharniere + d.s * w + q.s * epaisseurVantail, t: tCharniere + d.t * w + q.t * epaisseurVantail },
      { s: sCharniere + q.s * epaisseurVantail, t: tCharniere + q.t * epaisseurVantail },
    ].map((p) => point(p.s, p.t));
    vantaux.prisme(coins, z0, z1 - 1);
    return;
  }

  // Fenêtre, porte-fenêtre, baie : cadre de 5 cm, vitrage au milieu de l'épaisseur.
  const profondeur = Math.min(Math.max(e, 2), 7);
  const tm = e / 2;
  const t0 = tm - profondeur / 2;
  const t1 = tm + profondeur / 2;
  const c = Math.min(5, largeur / 4, h / 4);
  const { debut, fin } = seg;
  cadres.prisme(rect(debut, debut + c, t0, t1), z0, z1, { dessous: z0 > 0 });
  cadres.prisme(rect(fin - c, fin, t0, t1), z0, z1, { dessous: z0 > 0 });
  cadres.prisme(rect(debut + c, fin - c, t0, t1), z0, z0 + c, { dessous: z0 > 0 });
  cadres.prisme(rect(debut + c, fin - c, t0, t1), z1 - c, z1, { dessous: true });
  // Deux vantaux (meneau central) au-delà de 90 cm de large.
  if (largeur >= 90) {
    const m = (debut + fin) / 2;
    cadres.prisme(rect(m - c / 2, m + c / 2, t0, t1), z0 + c, z1 - c, { dessus: false });
  }
  vitrages.prisme(rect(debut + c, fin - c, tm - 0.6, tm + 0.6), z0 + c, z1 - c, { dessous: true });
}

// ─── Étiquettes des pièces ──────────────────────────────────────────────────

export interface EtiquettePiece {
  pieceId: string;
  nom: string;
  /** Surface au sol (m²) et sa version formatée (« 3,57 m² »). */
  aire: number;
  surface: string;
  /** Position au sol, dans la scène (m). */
  position: Point3;
}

/** Nom et surface de chaque pièce, posés au sol à l'endroit le plus dégagé. */
export function etiquettesPieces(plan: Plan): EtiquettePiece[] {
  return plan.pieces
    .filter((p) => p.sommets.length >= 3 && aire(p.sommets) >= 1)
    .map((p) => ({
      pieceId: p.id,
      nom: p.nom,
      aire: aire(p.sommets) / 1e4,
      surface: formaterValeur(aire(p.sommets) / 1e4, 'm²'),
      position: versScene(pointEtiquette(p.sommets), 1),
    }));
}
