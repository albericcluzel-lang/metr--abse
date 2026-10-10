// Tests de touche : qu'y a-t-il sous le doigt (ou le pointeur) ?
// Toutes les distances sont en cm ; l'appelant convertit ses tolérances
// écran (px) avec l'échelle de la vue.

import { epaisseurCote, segmentOuverture } from '../../geometrie/piece';
import { contientPoint, distance, longueurCote, normaleExterieure, suivant, tourner } from '../../geometrie/polygone';
import type { Catalogue, ID, Piece, Plan, Point } from '../../model/types';

/** Pièce dont l'intérieur contient `p` (la dernière dessinée, donc celle du dessus). */
export function pieceSousPoint(plan: Plan, p: Point): Piece | null {
  for (let k = plan.pieces.length - 1; k >= 0; k--) {
    const piece = plan.pieces[k];
    if (piece.sommets.length >= 3 && contientPoint(piece.sommets, p)) return piece;
  }
  return null;
}

export interface ToucheCote {
  pieceId: ID;
  index: number;
  /** Distance (cm) du début du côté au projeté du point, bornée au côté. */
  abscisse: number;
}

/**
 * Côté dont la bande de mur (du nu intérieur jusqu'à la face extérieure)
 * passe à moins de `tol` cm de `p`. La pièce `prioritaire` (sélectionnée)
 * l'emporte quand deux murs se superposent.
 */
export function coteSousPoint(
  plan: Plan,
  catalogue: Catalogue,
  p: Point,
  tol: number,
  prioritaire?: ID | null,
): ToucheCote | null {
  let meilleur: ToucheCote | null = null;
  let score = Infinity;
  for (const piece of plan.pieces) {
    const n = piece.sommets.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const a = piece.sommets[i];
      const b = suivant(piece.sommets, i);
      const l = longueurCote(piece.sommets, i);
      if (l <= 0) continue;
      const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
      const nrm = normaleExterieure(piece.sommets, i);
      const ep = epaisseurCote(piece, i, catalogue);
      const t = (p.x - a.x) * u.x + (p.y - a.y) * u.y;
      const s = (p.x - a.x) * nrm.x + (p.y - a.y) * nrm.y;
      if (t < -tol || t > l + tol || s < -tol || s > ep + tol) continue;
      // Distance à la bande de mur (0 dedans), plus l'éventuel dépassement en bout de côté.
      const horsBande = Math.max(0, -s, s - ep) + Math.max(0, -t, t - l);
      const sc = horsBande - (piece.id === prioritaire ? tol : 0);
      if (sc < score) {
        score = sc;
        meilleur = { pieceId: piece.id, index: i, abscisse: Math.min(l, Math.max(0, t)) };
      }
    }
  }
  return meilleur;
}

export interface ToucheOuverture {
  pieceId: ID;
  ouvertureId: ID;
  /** Abscisse du point le long du côté porteur (cm, depuis le début du côté). */
  abscisse: number;
}

/** Ouverture dont l'emprise dans le mur passe à moins de `tol` cm de `p`. */
export function ouvertureSousPoint(
  plan: Plan,
  catalogue: Catalogue,
  p: Point,
  tol: number,
  prioritaire?: ID | null,
): ToucheOuverture | null {
  let meilleur: ToucheOuverture | null = null;
  let score = Infinity;
  for (const piece of plan.pieces) {
    for (const o of piece.ouvertures) {
      const seg = segmentOuverture(piece, o);
      if (!seg) continue;
      const a = piece.sommets[o.cote];
      const b = suivant(piece.sommets, o.cote);
      const u = { x: (b.x - a.x) / seg.longueurCote, y: (b.y - a.y) / seg.longueurCote };
      const nrm = normaleExterieure(piece.sommets, o.cote);
      const ep = epaisseurCote(piece, o.cote, catalogue);
      const t = (p.x - a.x) * u.x + (p.y - a.y) * u.y;
      const s = (p.x - a.x) * nrm.x + (p.y - a.y) * nrm.y;
      if (t < seg.debut - tol || t > seg.fin + tol || s < -tol || s > ep + tol) continue;
      const sc = Math.abs(t - (seg.debut + seg.fin) / 2) - (piece.id === prioritaire ? 1e6 : 0);
      if (sc < score) {
        score = sc;
        meilleur = { pieceId: piece.id, ouvertureId: o.id, abscisse: t };
      }
    }
  }
  return meilleur;
}

export interface ToucheEquipement {
  pieceId: ID;
  equipementId: ID;
}

/** Équipement dont le rectangle (élargi de `tol` cm) contient `p` ; celui du dessus d'abord. */
export function equipementSousPoint(plan: Plan, p: Point, tol: number): ToucheEquipement | null {
  for (let k = plan.pieces.length - 1; k >= 0; k--) {
    const piece = plan.pieces[k];
    for (let j = piece.equipements.length - 1; j >= 0; j--) {
      const e = piece.equipements[j];
      const local = tourner(p, (-e.rotation * Math.PI) / 180, { x: e.x, y: e.y });
      if (Math.abs(local.x - e.x) <= e.largeur / 2 + tol && Math.abs(local.y - e.y) <= e.profondeur / 2 + tol) {
        return { pieceId: piece.id, equipementId: e.id };
      }
    }
  }
  return null;
}

/** Index du sommet le plus proche à moins de `tol` cm, ou -1. */
export function sommetProche(sommets: readonly Point[], p: Point, tol: number): number {
  let meilleur = -1;
  let dMin = tol;
  sommets.forEach((s, i) => {
    const d = distance(s, p);
    if (d <= dMin) {
      dMin = d;
      meilleur = i;
    }
  });
  return meilleur;
}

/** Écart (px écran) entre la face extérieure du mur et le centre de la poignée « + ». */
export const ECART_POIGNEE_MILIEU_PX = 22;

/**
 * Position à l'écran (px) des poignées « + » qui coupent les côtés : au
 * milieu de chaque côté, juste au-delà de la face extérieure du mur, pour ne
 * pas gêner le toucher du mur lui-même. null pour un côté trop court à l'écran.
 */
export function poigneesMilieux(
  piece: Piece,
  catalogue: Catalogue,
  versEcran: (p: Point) => Point,
  echelle: number,
  longueurMinPx: number,
  ecartPx = ECART_POIGNEE_MILIEU_PX,
): (Point | null)[] {
  return piece.sommets.map((a, i) => {
    if (longueurCote(piece.sommets, i) * echelle < longueurMinPx) return null;
    const b = suivant(piece.sommets, i);
    const m = versEcran({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const n = normaleExterieure(piece.sommets, i);
    const d = epaisseurCote(piece, i, catalogue) * echelle + ecartPx;
    return { x: m.x + n.x * d, y: m.y + n.y * d };
  });
}

/** Index de la poignée la plus proche de `p` à moins de `rayon`, ou -1. */
export function poigneeProche(poignees: readonly (Point | null)[], p: Point, rayon: number): number {
  let meilleur = -1;
  let dMin = rayon;
  poignees.forEach((q, i) => {
    if (!q) return;
    const d = distance(q, p);
    if (d <= dMin) {
      dMin = d;
      meilleur = i;
    }
  });
  return meilleur;
}
