// Relevé au mètre laser : on fait le tour de la pièce dans le sens des
// aiguilles d'une montre en saisissant chaque côté, puis le virage vers le
// côté suivant. Repère écran (y vers le bas) : un virage à droite tourne de
// +90° (sens horaire à l'écran). Longueurs en cm, angles en degrés.

import type { Point } from '../../model/types';
import { aire, distance } from '../../geometrie/polygone';
import { estPolygoneSimple } from './geometrieReleve';

export interface CoteLaser {
  /** Longueur mesurée (cm). */
  longueur: number;
  /** Virage effectué au bout de ce côté (degrés) : +90 = à droite, −90 = à gauche. */
  virage: number;
}

export const VIRAGE_DROITE = 90;
export const VIRAGE_GAUCHE = -90;

/** Au-delà de cet écart (cm), la fermeture signale une erreur de mesure probable. */
export const ECART_ALERTE_CM = 5;
/**
 * Au-delà de cet écart (cm), le segment de fermeture n'est plus une erreur de
 * mesure mais un côté non mesuré : il devient un côté à part entière.
 */
export const ECART_FUSION_CM = 30;

/** Direction unitaire d'un cap (degrés), exacte pour les multiples de 90°. */
export function directionCap(capDeg: number): Point {
  const c = ((capDeg % 360) + 360) % 360;
  if (c === 0) return { x: 1, y: 0 };
  if (c === 90) return { x: 0, y: 1 };
  if (c === 180) return { x: -1, y: 0 };
  if (c === 270) return { x: 0, y: -1 };
  const r = (c * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
}

export interface TraceLaser {
  /** Début de chaque côté saisi ; le premier est l'origine (0, 0). */
  sommets: Point[];
  /** Fin du dernier côté saisi (position courante). */
  extremite: Point;
  /** Cap du prochain côté (degrés, 0 = vers la droite). */
  cap: number;
  /** Longueur du segment de fermeture, de l'extrémité au point de départ (cm). */
  ecartFermeture: number;
}

/** Parcourt les côtés saisis, le premier partant de l'origine vers la droite. */
export function tracerLaser(cotes: readonly CoteLaser[], capInitial = 0): TraceLaser {
  let p: Point = { x: 0, y: 0 };
  let cap = capInitial;
  const sommets: Point[] = [];
  for (const c of cotes) {
    sommets.push(p);
    const d = directionCap(cap);
    p = { x: p.x + d.x * c.longueur, y: p.y + d.y * c.longueur };
    cap = normaliserCap(cap + c.virage);
  }
  return {
    sommets,
    extremite: p,
    cap,
    ecartFermeture: sommets.length > 0 ? distance(p, sommets[0]) : 0,
  };
}

function normaliserCap(cap: number): number {
  return ((cap % 360) + 360) % 360;
}

export interface PolygoneLaser {
  /** Contour fermé proposé (cm). */
  points: Point[];
  /** Distance entre la fin du dernier côté et le point de départ (cm). */
  ecartFermeture: number;
  /** Le segment de fermeture devient un côté (le dernier côté n'a pas été mesuré). */
  coteFermetureCalcule: boolean;
  /** Écart de fermeture assez grand pour signaler une erreur de mesure probable. */
  ecartImportant: boolean;
  /** Au moins 3 sommets, aucun croisement, surface non nulle. */
  valide: boolean;
}

/**
 * Ferme la pièce : le dernier sommet rejoint le premier.
 *  - écart ≤ ECART_FUSION_CM : c'est une erreur de mesure, la fin du dernier
 *    côté est ramenée sur le point de départ (signalée au-delà de ECART_ALERTE_CM) ;
 *  - écart plus grand : le dernier côté n'a pas été mesuré, le segment de
 *    fermeture devient un côté calculé.
 */
export function construirePolygoneLaser(cotes: readonly CoteLaser[]): PolygoneLaser {
  const trace = tracerLaser(cotes);
  const ecart = trace.ecartFermeture;
  const fusion = ecart <= ECART_FUSION_CM;
  const points = (fusion ? trace.sommets : [...trace.sommets, trace.extremite]).map(arrondirPoint);
  const valide = points.length >= 3 && estPolygoneSimple(points) && aire(points) >= 100;
  return {
    points,
    ecartFermeture: ecart,
    coteFermetureCalcule: !fusion,
    ecartImportant: fusion && ecart > ECART_ALERTE_CM,
    valide,
  };
}

/** Virage (degrés) correspondant à un angle intérieur mesuré dans la pièce. */
export function virageDepuisAngleInterieur(angleInterieurDeg: number): number {
  return 180 - angleInterieurDeg;
}

/** « à droite de 90° », « à gauche de 45° », « tout droit ». */
export function libelleVirage(virage: number): string {
  const v = Math.round(((((virage + 180) % 360) + 360) % 360) - 180);
  if (v === 0) return 'tout droit';
  return `à ${v > 0 ? 'droite' : 'gauche'} de ${Math.abs(v)}°`;
}

function arrondirPoint(p: Point): Point {
  return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
}
