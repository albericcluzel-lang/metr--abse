// Outils géométriques du relevé : validité d'un contour saisi, suppression
// des angles plats, cadrage des aperçus SVG. Longueurs en cm, repère écran
// (x vers la droite, y vers le bas).

import type { Point } from '../../model/types';
import { boiteEnglobante, distance, suivant } from '../../geometrie/polygone';

const EPS = 1e-6;

function orientation(p: Point, q: Point, r: Point): number {
  const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return Math.abs(v) < EPS ? 0 : Math.sign(v);
}

/** r est-il dans la boîte du segment [p, q] (r supposé aligné avec p et q) ? */
function dansBoite(p: Point, q: Point, r: Point): boolean {
  return (
    Math.min(p.x, q.x) - EPS <= r.x &&
    r.x <= Math.max(p.x, q.x) + EPS &&
    Math.min(p.y, q.y) - EPS <= r.y &&
    r.y <= Math.max(p.y, q.y) + EPS
  );
}

/** Les segments [a, b] et [c, d] ont-ils au moins un point commun ? */
export function segmentsSeCoupent(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && dansBoite(a, b, c)) return true;
  if (o2 === 0 && dansBoite(a, b, d)) return true;
  if (o3 === 0 && dansBoite(c, d, a)) return true;
  if (o4 === 0 && dansBoite(c, d, b)) return true;
  return false;
}

/**
 * Le contour fermé est-il un polygone simple : au moins 3 sommets distincts,
 * aucun côté nul, aucun croisement, aucun demi-tour sur place ?
 */
export function estPolygoneSimple(points: readonly Point[]): boolean {
  const n = points.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    if (distance(points[i], suivant(points, i)) < 0.01) return false;
  }
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = suivant(points, i);
    // Côtés consécutifs : demi-tour (repli sur le même mur) interdit.
    const c = suivant(points, i + 1);
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const sinus = (ux * vy - uy * vx) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    if (Math.abs(sinus) < 1e-6 && ux * vx + uy * vy < 0) return false;
    // Côtés non consécutifs : aucun point commun.
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsSeCoupent(a, b, points[j], suivant(points, j))) return false;
    }
  }
  return true;
}

/** Angle de virage (radians, ]-π, π]) au sommet b entre [a, b] et [b, c]. */
export function virageAuSommet(a: Point, b: Point, c: Point): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/**
 * Retire les sommets où le contour ne tourne presque pas (angle plat, à
 * `toleranceDeg` près) et les sommets confondus : un angle posé au milieu
 * d'un mur en réalité augmentée ne doit pas créer un côté de plus.
 */
export function retirerAnglesPlats(points: readonly Point[], toleranceDeg = 8): Point[] {
  const tol = (toleranceDeg * Math.PI) / 180;
  const pts = points.map((p) => ({ ...p }));
  let change = true;
  while (change && pts.length > 3) {
    change = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (distance(a, b) < 0.5 || Math.abs(virageAuSommet(a, b, c)) < tol) {
        pts.splice(i, 1);
        change = true;
        break;
      }
    }
  }
  return pts;
}

export interface Cadrage {
  /** Pixels par cm. */
  echelle: number;
  transformer(p: Point): Point;
}

/**
 * Cadre un ensemble de points (cm) dans un rectangle de `largeur` × `hauteur`
 * pixels avec une marge, centré, sans déformation. `echelleMax` évite de
 * grossir démesurément un dessin minuscule (ou un point seul).
 */
export function cadrer(
  points: readonly Point[],
  largeur: number,
  hauteur: number,
  marge = 16,
  echelleMax = 2,
): Cadrage {
  if (points.length === 0) {
    return { echelle: echelleMax, transformer: (p) => ({ x: largeur / 2 + p.x, y: hauteur / 2 + p.y }) };
  }
  const { minX, minY, maxX, maxY } = boiteEnglobante(points);
  const l = Math.max(maxX - minX, EPS);
  const h = Math.max(maxY - minY, EPS);
  const echelle = Math.min((largeur - 2 * marge) / l, (hauteur - 2 * marge) / h, echelleMax);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    echelle,
    transformer: (p) => ({ x: largeur / 2 + (p.x - cx) * echelle, y: hauteur / 2 + (p.y - cy) * echelle }),
  };
}

/** Chemin SVG (attribut d) d'une ligne brisée, fermée ou non. */
export function cheminSvg(points: readonly Point[], ferme: boolean): string {
  if (points.length === 0) return '';
  const r = (v: number) => Math.round(v * 10) / 10;
  const corps = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${r(p.x)} ${r(p.y)}`).join(' ');
  return ferme ? `${corps} Z` : corps;
}
