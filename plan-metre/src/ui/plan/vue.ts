// Vue de l'éditeur : passage plan (cm) ↔ écran (px), zoom, pincer, ajustement
// au contenu et pas du quadrillage.

import { contourExterieur, coinsEquipement } from '../../geometrie/piece';
import { distance } from '../../geometrie/polygone';
import type { Catalogue, Plan, Point } from '../../model/types';

/** Écran = plan × echelle + (tx, ty). `echelle` en px par cm. */
export interface Vue {
  echelle: number;
  tx: number;
  ty: number;
}

/** 1 px = 50 cm : un bâtiment de 200 m tient dans un téléphone. */
export const ECHELLE_MIN = 0.02;
/** 1 cm = 12 px : assez pour placer une poignée au centimètre près. */
export const ECHELLE_MAX = 12;

export interface Boite {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Marges {
  haut: number;
  droite: number;
  bas: number;
  gauche: number;
}

export function versEcran(v: Vue, p: Point): Point {
  return { x: p.x * v.echelle + v.tx, y: p.y * v.echelle + v.ty };
}

export function versPlan(v: Vue, p: Point): Point {
  return { x: (p.x - v.tx) / v.echelle, y: (p.y - v.ty) / v.echelle };
}

function bornerEchelle(e: number): number {
  return Math.min(ECHELLE_MAX, Math.max(ECHELLE_MIN, e));
}

/** Zoom de `facteur` en gardant immobile le point de l'écran `centre`. */
export function zoomer(v: Vue, facteur: number, centre: Point): Vue {
  const echelle = bornerEchelle(v.echelle * facteur);
  const p = versPlan(v, centre);
  return { echelle, tx: centre.x - p.x * echelle, ty: centre.y - p.y * echelle };
}

/**
 * Pincer à deux doigts : les doigts partent de (a0, b0) et arrivent en
 * (a1, b1). Le point du plan sous le milieu de départ suit le milieu
 * d'arrivée ; l'échelle suit l'écartement des doigts.
 */
export function pincer(depart: Vue, a0: Point, b0: Point, a1: Point, b1: Point): Vue {
  const d0 = distance(a0, b0);
  const facteur = d0 > 1 ? distance(a1, b1) / d0 : 1;
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const echelle = bornerEchelle(depart.echelle * facteur);
  const p = versPlan(depart, m0);
  return { echelle, tx: m1.x - p.x * echelle, ty: m1.y - p.y * echelle };
}

/** Étendue d'un plan : contours extérieurs, équipements et points supplémentaires (photos). */
export function boitePlan(plan: Plan, catalogue: Catalogue, autres: readonly Point[] = []): Boite | null {
  const points: Point[] = [...autres];
  for (const p of plan.pieces) {
    if (p.sommets.length < 3) continue;
    points.push(...contourExterieur(p, catalogue));
    for (const e of p.equipements) points.push(...coinsEquipement(e));
  }
  const finis = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (finis.length === 0) return null;
  return {
    minX: Math.min(...finis.map((p) => p.x)),
    minY: Math.min(...finis.map((p) => p.y)),
    maxX: Math.max(...finis.map((p) => p.x)),
    maxY: Math.max(...finis.map((p) => p.y)),
  };
}

/**
 * Vue qui montre toute la boîte dans la zone utile (écran moins les marges
 * occupées par les commandes). Sans contenu : environ 5 m autour de l'origine.
 */
export function ajusterVue(
  boite: Boite | null,
  largeur: number,
  hauteur: number,
  marges: Marges,
  echelleMaxAjustement = 3,
): Vue {
  const lu = Math.max(40, largeur - marges.gauche - marges.droite);
  const hu = Math.max(40, hauteur - marges.haut - marges.bas);
  const ex = marges.gauche + lu / 2;
  const ey = marges.haut + hu / 2;
  if (!boite) {
    const echelle = bornerEchelle(Math.min(lu, hu) / 500);
    return { echelle, tx: ex, ty: ey };
  }
  const bl = Math.max(boite.maxX - boite.minX, 50);
  const bh = Math.max(boite.maxY - boite.minY, 50);
  const echelle = bornerEchelle(Math.min(lu / bl, hu / bh, echelleMaxAjustement));
  const cx = (boite.minX + boite.maxX) / 2;
  const cy = (boite.minY + boite.maxY) / 2;
  return { echelle, tx: ex - cx * echelle, ty: ey - cy * echelle };
}

const PAS_GRILLE_CM = [10, 100, 1000, 10000];

/**
 * Quadrillage adaptatif : maille fine (10 cm, sinon 1 m…) dès qu'elle fait au
 * moins `minPx` à l'écran, et maille forte dix fois plus grande.
 */
export function pasGrille(echelle: number, minPx = 8): { fin: number; fort: number } {
  let i = PAS_GRILLE_CM.findIndex((p) => p * echelle >= minPx);
  if (i < 0 || i > PAS_GRILLE_CM.length - 2) i = PAS_GRILLE_CM.length - 2;
  return { fin: PAS_GRILLE_CM[i], fort: PAS_GRILLE_CM[i + 1] };
}
