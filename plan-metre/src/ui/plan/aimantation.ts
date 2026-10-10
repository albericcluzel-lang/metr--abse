// Aimantations de l'éditeur : grille, sommets des autres pièces, angles
// (0 / 45 / 90° par rapport au côté précédent), alignements, et « mur à
// mur » quand on déplace une pièce contre une autre.

import { contourExterieur, epaisseurCote, typeMurIdCote } from '../../geometrie/piece';
import { distance, longueurCote, normaleExterieure, precedent, suivant } from '../../geometrie/polygone';
import type { Catalogue, ID, Piece, Point } from '../../model/types';

/** Pas de la grille d'aimantation (cm). */
export const PAS_GRILLE = 5;
/** Tolérance sur les angles remarquables (degrés). */
export const TOLERANCE_ANGLE_DEG = 7;
/** Distance (cm) en deçà de laquelle une pièce déplacée se cale contre un mur voisin. */
export const SEUIL_MUR_A_MUR = 15;

const COS_PARALLELE = Math.cos((3 * Math.PI) / 180);

function arrondirPas(v: number, pas: number): number {
  return Math.round(v / pas) * pas + 0; // « + 0 » évite -0
}

export function aimanterGrille(p: Point, pas = PAS_GRILLE): Point {
  return { x: arrondirPas(p.x, pas), y: arrondirPas(p.y, pas) };
}

/**
 * Cibles d'aimantation : sommets intérieurs et extérieurs (nu extérieur des
 * murs) des pièces, sauf la pièce `exclure`.
 */
export function sommetsAimantables(pieces: readonly Piece[], catalogue: Catalogue, exclure?: ID): Point[] {
  const res: Point[] = [];
  for (const p of pieces) {
    if (p.id === exclure || p.sommets.length < 3) continue;
    for (const s of p.sommets) res.push({ x: s.x, y: s.y });
    for (const s of contourExterieur(p, catalogue)) res.push(s);
  }
  return res;
}

export type TypeAimant = 'premier' | 'sommet' | 'angle' | 'alignement' | 'grille';

export interface Aimant {
  point: Point;
  type: TypeAimant;
  /** Le point referme le tracé sur son premier sommet. */
  ferme?: boolean;
  /** Angle relatif retenu (degrés) pour l'aimantation d'angle. */
  angle?: number;
}

export interface OptionsDessin {
  /** Sommets des autres pièces. */
  cibles: readonly Point[];
  /** Rayon d'aimantation (cm), en pratique ~12 px écran. */
  toleranceCm: number;
  toleranceAngleDeg?: number;
  pas?: number;
}

function plusProche(p: Point, cibles: readonly Point[], tol: number): Point | null {
  let meilleur: Point | null = null;
  let dMin = tol;
  for (const c of cibles) {
    const d = distance(p, c);
    if (d <= dMin) {
      dMin = d;
      meilleur = c;
    }
  }
  return meilleur;
}

/**
 * Point du tracé d'une nouvelle pièce, dans l'ordre de priorité :
 * premier point (fermeture, dès 3 points), sommet d'une autre pièce, angle
 * remarquable par rapport au côté précédent (longueur arrondie à la grille,
 * calée sur l'alignement du premier point), grille.
 */
export function aimanterPointDessin(brut: Point, trace: readonly Point[], o: OptionsDessin): Aimant {
  const tol = o.toleranceCm;
  const pas = o.pas ?? PAS_GRILLE;
  if (trace.length >= 3 && distance(brut, trace[0]) <= tol) {
    return { point: { x: trace[0].x, y: trace[0].y }, type: 'premier', ferme: true };
  }
  const cible = plusProche(brut, o.cibles, tol);
  if (cible) return { point: { x: cible.x, y: cible.y }, type: 'sommet' };

  const dernier = trace[trace.length - 1];
  if (dernier) {
    const avant = trace[trace.length - 2];
    const ref = avant ? Math.atan2(dernier.y - avant.y, dernier.x - avant.x) : 0;
    const angle = Math.atan2(brut.y - dernier.y, brut.x - dernier.x);
    let rel = angle - ref;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel <= -Math.PI) rel += 2 * Math.PI;
    const huitieme = Math.PI / 4;
    const k = Math.round(rel / huitieme);
    const tolAngle = ((o.toleranceAngleDeg ?? TOLERANCE_ANGLE_DEG) * Math.PI) / 180;
    // |k| = 4 : demi-tour sur le côté précédent, sans intérêt.
    if (Math.abs(k) < 4 && Math.abs(rel - k * huitieme) <= tolAngle) {
      const a = ref + k * huitieme;
      const u = { x: Math.cos(a), y: Math.sin(a) };
      const l = (brut.x - dernier.x) * u.x + (brut.y - dernier.y) * u.y;
      if (l > 0) {
        const lArrondie = Math.max(pas, arrondirPas(l, pas));
        let point = { x: dernier.x + u.x * lArrondie, y: dernier.y + u.y * lArrondie };
        let type: TypeAimant = 'angle';
        // Alignement sur le premier point (pour refermer la pièce d'équerre).
        const premier = trace[0];
        if (trace.length >= 2) {
          for (const [axe, comp] of [
            ['x', u.x],
            ['y', u.y],
          ] as const) {
            if (Math.abs(comp) < 1e-6) continue;
            const t = (premier[axe] - dernier[axe]) / comp;
            if (t <= 0) continue;
            const q = { x: dernier.x + u.x * t, y: dernier.y + u.y * t };
            if (distance(q, point) <= Math.max(tol, pas)) {
              point = q;
              type = 'alignement';
              break;
            }
          }
        }
        return { point: arrondirPoint(point), type, angle: (k * 45 + 360) % 360 };
      }
    }
  }
  return { point: aimanterGrille(brut, pas), type: 'grille' };
}

function arrondirPoint(p: Point): Point {
  return { x: Number(p.x.toFixed(4)) + 0, y: Number(p.y.toFixed(4)) + 0 };
}

/**
 * Sommet déplacé à la main : sommet d'une autre pièce, sinon alignement
 * horizontal / vertical avec les sommets adjacents, sinon grille (pour
 * chaque coordonnée non alignée).
 */
export function aimanterSommet(
  brut: Point,
  sommets: readonly Point[],
  index: number,
  cibles: readonly Point[],
  toleranceCm: number,
  pas = PAS_GRILLE,
): Aimant {
  const cible = plusProche(brut, cibles, toleranceCm);
  if (cible) return { point: { x: cible.x, y: cible.y }, type: 'sommet' };
  const voisins = sommets.length >= 3 ? [precedent(sommets, index), suivant(sommets, index)] : [];
  let x: number | null = null;
  let y: number | null = null;
  let dx = toleranceCm;
  let dy = toleranceCm;
  for (const v of voisins) {
    if (Math.abs(brut.x - v.x) <= dx) {
      dx = Math.abs(brut.x - v.x);
      x = v.x;
    }
    if (Math.abs(brut.y - v.y) <= dy) {
      dy = Math.abs(brut.y - v.y);
      y = v.y;
    }
  }
  const point = { x: x ?? arrondirPas(brut.x, pas), y: y ?? arrondirPas(brut.y, pas) };
  return { point, type: x !== null || y !== null ? 'alignement' : 'grille' };
}

interface CandidatMurAMur {
  correction: Point;
  normale: Point;
  ecart: number;
}

/**
 * Aimantation « mur à mur » d'une pièce que l'on déplace (déjà translatée) :
 * un côté parallèle qui arrive à moins de `seuil` cm de la face extérieure
 * d'un mur d'une autre pièce s'y cale (les deux pièces sont alors séparées
 * exactement de l'épaisseur de ce mur). Si l'autre côté n'a pas de mur, c'est
 * la face extérieure du mur de la pièce déplacée qui se cale sur lui.
 * Renvoie la correction à ajouter à la translation (au plus une par direction).
 */
export function aimanterMurAMur(
  piece: Piece,
  autres: readonly Piece[],
  catalogue: Catalogue,
  seuil = SEUIL_MUR_A_MUR,
): Point {
  const candidats: CandidatMurAMur[] = [];
  const n = piece.sommets.length;
  if (n < 3) return { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    const a = piece.sommets[i];
    const b = suivant(piece.sommets, i);
    const li = longueurCote(piece.sommets, i);
    if (li < 1) continue;
    const u = { x: (b.x - a.x) / li, y: (b.y - a.y) / li };
    const ni = normaleExterieure(piece.sommets, i);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const autre of autres) {
      if (autre.id === piece.id || autre.sommets.length < 3) continue;
      for (let j = 0; j < autre.sommets.length; j++) {
        const c = autre.sommets[j];
        const d = suivant(autre.sommets, j);
        const lj = longueurCote(autre.sommets, j);
        if (lj < 1) continue;
        const v = { x: (d.x - c.x) / lj, y: (d.y - c.y) / lj };
        if (Math.abs(u.x * v.x + u.y * v.y) < COS_PARALLELE) continue;
        const nj = normaleExterieure(autre.sommets, j);
        // Les deux côtés se font face : normales extérieures opposées.
        if (ni.x * nj.x + ni.y * nj.y > -COS_PARALLELE) continue;
        const epAutre = typeMurIdCote(autre, j) === null ? 0 : epaisseurCote(autre, j, catalogue);
        const epPiece = typeMurIdCote(piece, i) === null ? 0 : epaisseurCote(piece, i, catalogue);
        const cibleEcart = epAutre > 0 ? epAutre : epPiece;
        const ecart = (m.x - c.x) * nj.x + (m.y - c.y) * nj.y - cibleEcart;
        if (Math.abs(ecart) > seuil) continue;
        // Les deux côtés doivent se recouvrir le long du mur.
        const t1 = (a.x - c.x) * v.x + (a.y - c.y) * v.y;
        const t2 = (b.x - c.x) * v.x + (b.y - c.y) * v.y;
        const recouvrement = Math.min(Math.max(t1, t2), lj) - Math.max(Math.min(t1, t2), 0);
        if (recouvrement <= 1) continue;
        candidats.push({ correction: { x: -ecart * nj.x, y: -ecart * nj.y }, normale: nj, ecart: Math.abs(ecart) });
      }
    }
  }
  if (candidats.length === 0) return { x: 0, y: 0 };
  candidats.sort((p, q) => p.ecart - q.ecart);
  const premier = candidats[0];
  const correction = { ...premier.correction };
  // Seconde direction (pièce glissée dans un angle entre deux pièces).
  const second = candidats.find(
    (c) => Math.abs(c.normale.x * premier.normale.x + c.normale.y * premier.normale.y) < Math.cos((80 * Math.PI) / 180),
  );
  if (second) {
    correction.x += second.correction.x;
    correction.y += second.correction.y;
  }
  return correction;
}
