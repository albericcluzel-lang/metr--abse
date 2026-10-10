// Opérations pures de l'éditeur de plan. Chaque fonction renvoie une nouvelle
// pièce (ou un nouvel élément) sans modifier ses arguments.
//
// Les ouvertures sont repérées par leur côté (index) et leur distance au
// début du côté : toute opération qui ajoute, retire ou déplace des sommets
// doit réindexer `ouvertures[].cote` et recalculer `position`.

import { MODELES_EQUIPEMENTS, MODELES_OUVERTURES } from '../../model/catalogue';
import { nouvelEquipement, nouvelleOuverture } from '../../model/fabrique';
import type { Equipement, ID, Ouverture, Piece, Point, Sommet, TypeEquipement, TypeOuverture } from '../../model/types';
import {
  distance,
  distancePointSegment,
  longueurCote,
  normaleExterieure,
  orthogonaliser,
  suivant,
} from '../../geometrie/polygone';

function borner(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Arrondi au dixième de cm (évite d'accumuler les erreurs de virgule flottante). */
function arrondi(v: number, pas = 0.1): number {
  const r = Math.round(v / pas) * pas;
  return Number(r.toFixed(6)) + 0;
}

function direction(a: Point, b: Point): Point {
  const l = distance(a, b) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

/** Position d'une ouverture de largeur `largeur`, bornée à un côté de longueur `l`. */
export function bornerPosition(position: number, largeur: number, l: number): number {
  return borner(position, 0, Math.max(0, l - largeur));
}

/** Abscisse (cm, non bornée) de la projection de `p` sur la droite du côté i. */
export function abscisseSurCote(sommets: readonly Point[], i: number, p: Point): number {
  const a = sommets[i];
  const u = direction(a, suivant(sommets, i));
  return (p.x - a.x) * u.x + (p.y - a.y) * u.y;
}

/** Point du côté i situé à `t` cm de son début. */
export function pointSurCote(sommets: readonly Point[], i: number, t: number): Point {
  const a = sommets[i];
  const u = direction(a, suivant(sommets, i));
  return { x: a.x + u.x * t, y: a.y + u.y * t };
}

function milieuOuverture(piece: Piece, o: Ouverture): Point {
  return pointSurCote(piece.sommets, o.cote, o.position + o.largeur / 2);
}

function memePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Remplace les sommets d'une pièce (même nombre de sommets) : les ouvertures
 * des côtés modifiés gardent leur place dans le plan (projection de leur
 * milieu sur le nouveau côté), bornées au côté.
 */
export function avecSommets(avant: Piece, sommets: Sommet[]): Piece {
  const n = sommets.length;
  const ouvertures = avant.ouvertures.map((o) => {
    if (o.cote < 0 || o.cote >= n || n !== avant.sommets.length) return o;
    const inchange =
      memePoint(avant.sommets[o.cote], sommets[o.cote]) &&
      memePoint(suivant(avant.sommets, o.cote), suivant(sommets, o.cote));
    if (inchange) return o;
    const m = milieuOuverture(avant, o);
    const l = longueurCote(sommets, o.cote);
    const position = bornerPosition(abscisseSurCote(sommets, o.cote, m) - o.largeur / 2, o.largeur, l);
    return { ...o, position: arrondi(position) };
  });
  return { ...avant, sommets, ouvertures };
}

/**
 * Coupe le côté `cote` en deux par un nouveau sommet (au milieu, ou au
 * projeté de `point` sur le côté). Le nouveau sommet reprend le type de mur
 * du côté coupé. Une ouverture du côté coupé reste sur la moitié qui contient
 * son milieu, avec sa position recalculée.
 */
export function insererSommet(piece: Piece, cote: number, point?: Point): Piece {
  const n = piece.sommets.length;
  if (cote < 0 || cote >= n) return piece;
  const a = piece.sommets[cote];
  const l = longueurCote(piece.sommets, cote);
  const t = point ? borner(abscisseSurCote(piece.sommets, cote, point), 0, l) : l / 2;
  // Trop près d'un sommet existant : on ne crée pas de côté minuscule.
  if (t < 1 || t > l - 1) return piece;
  const m = pointSurCote(piece.sommets, cote, t);
  const nouveau: Sommet = { x: arrondi(m.x, 0.01), y: arrondi(m.y, 0.01) };
  if (a.typeMurId !== undefined) nouveau.typeMurId = a.typeMurId;
  const sommets = [...piece.sommets.slice(0, cote + 1).map((s) => ({ ...s })), nouveau, ...piece.sommets.slice(cote + 1).map((s) => ({ ...s }))];
  const ouvertures = piece.ouvertures.map((o) => {
    if (o.cote > cote) return { ...o, cote: o.cote + 1 };
    if (o.cote < cote) return o;
    const centre = o.position + o.largeur / 2;
    if (centre <= t) return { ...o, position: arrondi(bornerPosition(o.position, o.largeur, t)) };
    return { ...o, cote: cote + 1, position: arrondi(bornerPosition(o.position - t, o.largeur, l - t)) };
  });
  return { ...piece, sommets, ouvertures };
}

/**
 * Supprime le sommet `index` (la pièce garde au moins 3 sommets) : les deux
 * côtés qui l'entourent fusionnent et prennent le type de mur du premier.
 * Les ouvertures de ces deux côtés sont reportées sur le côté fusionné à leur
 * place dans le plan, ou supprimées si elles n'y tiennent pas.
 */
export function supprimerSommet(piece: Piece, index: number): Piece {
  const n = piece.sommets.length;
  if (n <= 3 || index < 0 || index >= n) return piece;
  const iPrec = (index - 1 + n) % n;
  const nouvelIndex = (j: number) => (j < index ? j : j - 1);
  const sommets = piece.sommets.filter((_, j) => j !== index).map((s) => ({ ...s }));
  const fusion = nouvelIndex(iPrec);
  const lFusion = longueurCote(sommets, fusion);
  const ouvertures: Ouverture[] = [];
  for (const o of piece.ouvertures) {
    if (o.cote < 0 || o.cote >= n) continue;
    if (o.cote !== iPrec && o.cote !== index) {
      ouvertures.push({ ...o, cote: nouvelIndex(o.cote) });
      continue;
    }
    if (o.largeur > lFusion) continue; // ne tient plus : supprimée
    const m = milieuOuverture(piece, o);
    const position = bornerPosition(abscisseSurCote(sommets, fusion, m) - o.largeur / 2, o.largeur, lFusion);
    ouvertures.push({ ...o, cote: fusion, position: arrondi(position) });
  }
  return { ...piece, sommets, ouvertures };
}

/**
 * Donne au côté `cote` la longueur `longueur` en déplaçant son sommet de fin
 * le long de la direction du côté. Avec `garderAngles`, le côté suivant est
 * translaté du même vecteur (une pièce rectangulaire reste rectangulaire).
 */
export function changerLongueurCote(piece: Piece, cote: number, longueur: number, garderAngles = true): Piece {
  const n = piece.sommets.length;
  if (cote < 0 || cote >= n || !(longueur > 0)) return piece;
  const iFin = (cote + 1) % n;
  const a = piece.sommets[cote];
  const b = piece.sommets[iFin];
  const l = distance(a, b);
  if (l < 1e-6) return piece;
  const u = direction(a, b);
  const d = { x: u.x * (longueur - l), y: u.y * (longueur - l) };
  const deplaces = new Set([iFin]);
  if (garderAngles) {
    const iSuivant = (cote + 2) % n;
    if (iSuivant !== cote) deplaces.add(iSuivant);
  }
  const sommets = piece.sommets.map((s, i) =>
    deplaces.has(i) ? { ...s, x: arrondi(s.x + d.x, 0.01), y: arrondi(s.y + d.y, 0.01) } : { ...s },
  );
  return avecSommets(piece, sommets);
}

/** Déplace le sommet `index` en `point` ; les ouvertures restent en place. */
export function deplacerSommet(piece: Piece, index: number, point: Point): Piece {
  if (index < 0 || index >= piece.sommets.length) return piece;
  const sommets = piece.sommets.map((s, i) => (i === index ? { ...s, x: point.x, y: point.y } : { ...s }));
  return avecSommets(piece, sommets);
}

/** Translate toute la pièce : sommets et équipements (les ouvertures suivent leur côté). */
export function deplacerPiece(piece: Piece, dx: number, dy: number): Piece {
  return {
    ...piece,
    sommets: piece.sommets.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
    equipements: piece.equipements.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy })),
  };
}

/** Redresse les angles presque droits (cf. geometrie/polygone : orthogonaliser). */
export function orthogonaliserPiece(piece: Piece): Piece {
  const pts = orthogonaliser(piece.sommets);
  const sommets = piece.sommets.map((s, i) => ({ ...s, x: arrondi(pts[i].x, 0.01), y: arrondi(pts[i].y, 0.01) }));
  return avecSommets(piece, sommets);
}

/**
 * Nouvelle ouverture sur le côté `cote`, centrée sur l'abscisse `abscisse`
 * (milieu du côté par défaut) et bornée au côté.
 */
export function ouvertureSurCote(piece: Piece, type: TypeOuverture, cote: number, abscisse?: number): Ouverture {
  const l = longueurCote(piece.sommets, cote);
  const largeur = Math.min(MODELES_OUVERTURES[type].largeur, Math.max(1, Math.floor(l)));
  const centre = abscisse ?? l / 2;
  return nouvelleOuverture(type, cote, arrondi(bornerPosition(centre - largeur / 2, largeur, l), 1), { largeur });
}

/**
 * Nouvel équipement posé au point `point` d'une pièce : il est orienté dos au
 * mur le plus proche et, s'il en est près, plaqué contre ce mur.
 */
export function placerEquipement(piece: Piece, type: TypeEquipement, point: Point): Equipement {
  const m = MODELES_EQUIPEMENTS[type];
  const e = nouvelEquipement(type, { x: Math.round(point.x), y: Math.round(point.y) });
  const n = piece.sommets.length;
  if (n < 3) return e;
  let meilleur = -1;
  let dMin = Infinity;
  for (let i = 0; i < n; i++) {
    if (longueurCote(piece.sommets, i) < 1) continue;
    const d = distancePointSegment(point, piece.sommets[i], suivant(piece.sommets, i));
    if (d < dMin) {
      dMin = d;
      meilleur = i;
    }
  }
  if (meilleur < 0) return e;
  const nrm = normaleExterieure(piece.sommets, meilleur);
  // Le dos de l'équipement (côté y < 0 avant rotation) regarde le mur.
  const rotation = ((Math.atan2(nrm.x, -nrm.y) * 180) / Math.PI + 360) % 360;
  e.rotation = arrondi(rotation) % 360;
  if (dMin <= m.profondeur / 2 + 40) {
    const l = longueurCote(piece.sommets, meilleur);
    const t =
      l >= m.largeur
        ? borner(abscisseSurCote(piece.sommets, meilleur, point), m.largeur / 2, l - m.largeur / 2)
        : l / 2;
    const p = pointSurCote(piece.sommets, meilleur, t);
    e.x = arrondi(p.x - (nrm.x * m.profondeur) / 2);
    e.y = arrondi(p.y - (nrm.y * m.profondeur) / 2);
  }
  return e;
}

/**
 * Change le type d'une ouverture : les dimensions encore égales à celles du
 * modèle de l'ancien type prennent celles du nouveau ; une porte garde une
 * allège nulle, une fenêtre posée au sol reçoit l'allège du modèle.
 */
export function changerTypeOuverture(o: Ouverture, type: TypeOuverture, longueurDuCote: number): Ouverture {
  if (o.type === type) return o;
  const ancien = MODELES_OUVERTURES[o.type];
  const nouveau = MODELES_OUVERTURES[type];
  const largeur = o.largeur === ancien.largeur ? Math.min(nouveau.largeur, Math.max(1, Math.floor(longueurDuCote))) : o.largeur;
  const hauteur = o.hauteur === ancien.hauteur ? nouveau.hauteur : o.hauteur;
  let allege = o.allege === ancien.allege ? nouveau.allege : o.allege;
  if (nouveau.allege === 0) allege = 0;
  else if (allege <= 0) allege = nouveau.allege;
  const centre = o.position + o.largeur / 2;
  return {
    ...o,
    type,
    largeur,
    hauteur,
    allege,
    position: arrondi(bornerPosition(centre - largeur / 2, largeur, longueurDuCote)),
  };
}

/** Change le type d'un équipement : nom et dimensions par défaut suivent s'ils n'ont pas été modifiés. */
export function changerTypeEquipement(e: Equipement, type: TypeEquipement): Equipement {
  if (e.type === type) return e;
  const ancien = MODELES_EQUIPEMENTS[e.type];
  const nouveau = MODELES_EQUIPEMENTS[type];
  return {
    ...e,
    type,
    nom: e.nom === ancien.libelle || e.nom.trim() === '' ? nouveau.libelle : e.nom,
    largeur: e.largeur === ancien.largeur ? nouveau.largeur : e.largeur,
    profondeur: e.profondeur === ancien.profondeur ? nouveau.profondeur : e.profondeur,
    hauteur: e.hauteur === ancien.hauteur ? nouveau.hauteur : e.hauteur,
    deduireSol: e.deduireSol === ancien.deduireSol ? nouveau.deduireSol : e.deduireSol,
  };
}

/** Retire l'équipement `id` de `source` et l'ajoute à `cible` (changement de pièce). */
export function transfererEquipement(source: Piece, cible: Piece, id: ID): { source: Piece; cible: Piece } {
  const e = source.equipements.find((x) => x.id === id);
  if (!e || source.id === cible.id) return { source, cible };
  return {
    source: { ...source, equipements: source.equipements.filter((x) => x.id !== id) },
    cible: { ...cible, equipements: [...cible.equipements, e] },
  };
}

function orientation(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function segmentsSeCoupent(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** Le contour fermé se recoupe-t-il (côtés non adjacents qui se croisent) ? */
export function seCroise(points: readonly Point[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // côtés adjacents par la fermeture
      if (segmentsSeCoupent(points[i], suivant(points, i), points[j], suivant(points, j))) return true;
    }
  }
  return false;
}
