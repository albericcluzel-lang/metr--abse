// Outils de géométrie plane. Repère écran : x vers la droite, y vers le bas.
// Toutes les longueurs sont en cm.

import type { Point } from '../model/types';

const EPS = 1e-9;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function suivant<T>(liste: readonly T[], i: number): T {
  return liste[(i + 1) % liste.length];
}

export function precedent<T>(liste: readonly T[], i: number): T {
  return liste[(i - 1 + liste.length) % liste.length];
}

/**
 * Aire signée (formule du lacet). Positive quand le contour tourne dans le
 * sens horaire à l'écran (y vers le bas).
 */
export function aireSignee(points: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = suivant(points, i);
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function aire(points: readonly Point[]): number {
  return Math.abs(aireSignee(points));
}

export function longueurCote(points: readonly Point[], i: number): number {
  return distance(points[i], suivant(points, i));
}

export function perimetre(points: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) s += longueurCote(points, i);
  return s;
}

/** Centre de gravité de la surface (repli sur la moyenne des sommets si aire nulle). */
export function centroide(points: readonly Point[]): Point {
  const a = aireSignee(points);
  if (Math.abs(a) < EPS) {
    const n = points.length || 1;
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = suivant(points, i);
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Test d'appartenance (lancer de rayon). Les points sur le bord sont indéterminés. */
export function contientPoint(points: readonly Point[], p: Point): boolean {
  let dedans = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      dedans = !dedans;
    }
  }
  return dedans;
}

export function boiteEnglobante(points: readonly Point[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Distance d'un point à un segment [a, b]. */
export function distancePointSegment(p: Point, a: Point, b: Point): number {
  const t = parametreProjection(p, a, b);
  const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return distance(p, q);
}

/** Paramètre t ∈ [0, 1] du projeté de p sur le segment [a, b]. */
export function parametreProjection(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < EPS) return 0;
  return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
}

/** Point de l'espace intérieur bien placé pour une étiquette (pas forcément le centroïde). */
export function pointEtiquette(points: readonly Point[]): Point {
  const c = centroide(points);
  if (points.length < 3 || contientPoint(points, c)) return c;
  // Pièce en L ou en U : on cherche, sur une grille, le point intérieur le
  // plus éloigné des bords.
  const { minX, minY, maxX, maxY } = boiteEnglobante(points);
  const pas = Math.max(maxX - minX, maxY - minY) / 24;
  let meilleur = c;
  let meilleureDistance = -1;
  for (let x = minX + pas / 2; x < maxX; x += pas) {
    for (let y = minY + pas / 2; y < maxY; y += pas) {
      const p = { x, y };
      if (!contientPoint(points, p)) continue;
      let d = Infinity;
      for (let i = 0; i < points.length; i++) {
        d = Math.min(d, distancePointSegment(p, points[i], suivant(points, i)));
      }
      if (d > meilleureDistance) {
        meilleureDistance = d;
        meilleur = p;
      }
    }
  }
  return meilleur;
}

/** Intersection des droites (p1, d1) et (p2, d2) ; null si parallèles. */
export function intersectionDroites(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-9 * Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y)) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / det;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/** Normale unitaire extérieure du côté i (le contour peut tourner dans les deux sens). */
export function normaleExterieure(points: readonly Point[], i: number): Point {
  const a = points[i];
  const b = suivant(points, i);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const sens = aireSignee(points) >= 0 ? 1 : -1;
  return { x: (dy / l) * sens, y: (-dx / l) * sens };
}

/**
 * Décale le contour vers l'extérieur, chaque côté i de `distances[i]` (cm).
 * Jonctions en onglet ; les angles très aigus sont plafonnés pour éviter les
 * pointes démesurées.
 */
export function decalerVersExterieur(points: readonly Point[], distances: readonly number[]): Point[] {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ ...p }));
  const lignes = points.map((a, i) => {
    const b = suivant(points, i);
    const nrm = normaleExterieure(points, i);
    const d = distances[i] ?? 0;
    return {
      p: { x: a.x + nrm.x * d, y: a.y + nrm.y * d },
      dir: { x: b.x - a.x, y: b.y - a.y },
      d,
      nrm,
    };
  });
  const resultat: Point[] = [];
  for (let i = 0; i < n; i++) {
    const avant = lignes[(i - 1 + n) % n];
    const apres = lignes[i];
    const sommet = points[i];
    const inter = intersectionDroites(avant.p, avant.dir, apres.p, apres.dir);
    const dmax = Math.max(avant.d, apres.d);
    if (inter && distance(inter, sommet) <= Math.max(dmax * 4, EPS)) {
      resultat.push(inter);
    } else {
      // Côtés alignés (ou angle trop aigu) : on décale selon la normale du côté suivant.
      resultat.push({ x: sommet.x + apres.nrm.x * apres.d, y: sommet.y + apres.nrm.y * apres.d });
    }
  }
  return resultat;
}

export function tourner(p: Point, angleRad: number, centre: Point = { x: 0, y: 0 }): Point {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return { x: centre.x + dx * c - dy * s, y: centre.y + dx * s + dy * c };
}

/** Coins d'un rectangle centré en (cx, cy), tourné de `rotationDeg` (sens horaire écran). */
export function coinsRectangle(
  cx: number,
  cy: number,
  largeur: number,
  profondeur: number,
  rotationDeg: number,
): Point[] {
  const a = (rotationDeg * Math.PI) / 180;
  const hl = largeur / 2;
  const hp = profondeur / 2;
  return [
    { x: -hl, y: -hp },
    { x: hl, y: -hp },
    { x: hl, y: hp },
    { x: -hl, y: hp },
  ].map((p) => {
    const q = tourner(p, a);
    return { x: q.x + cx, y: q.y + cy };
  });
}

/**
 * Découpe du polygone `sujet` (quelconque) par le polygone convexe `fenetre`
 * (algorithme de Sutherland–Hodgman). Sert à calculer l'emprise réelle d'un
 * équipement à l'intérieur d'une pièce.
 */
export function decouperParConvexe(sujet: readonly Point[], fenetre: readonly Point[]): Point[] {
  let sortie = sujet.map((p) => ({ ...p }));
  const sens = aireSignee(fenetre) >= 0 ? 1 : -1;
  for (let i = 0; i < fenetre.length && sortie.length > 0; i++) {
    const a = fenetre[i];
    const b = suivant(fenetre, i);
    const dedans = (p: Point) => sens * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= -EPS;
    const entree = sortie;
    sortie = [];
    for (let j = 0; j < entree.length; j++) {
      const courant = entree[j];
      const prec = entree[(j - 1 + entree.length) % entree.length];
      const cd = dedans(courant);
      const pd = dedans(prec);
      if (cd !== pd) {
        const inter = intersectionDroites(
          prec,
          { x: courant.x - prec.x, y: courant.y - prec.y },
          a,
          { x: b.x - a.x, y: b.y - a.y },
        );
        if (inter) sortie.push(inter);
      }
      if (cd) sortie.push(courant);
    }
  }
  return sortie;
}

/** Angle (radians, ]-π, π]) du côté i. */
export function angleCote(points: readonly Point[], i: number): number {
  const a = points[i];
  const b = suivant(points, i);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Ramène un angle dans ]-π/4, π/4] modulo π/2. */
function residuQuartDeTour(angle: number): number {
  const q = Math.PI / 2;
  let r = angle - Math.round(angle / q) * q;
  if (r <= -Math.PI / 4) r += q;
  return r;
}

/**
 * Orientation dominante du contour (radians) : moyenne, pondérée par la
 * longueur, de l'écart de chaque côté au quart de tour le plus proche.
 */
export function orientationDominante(points: readonly Point[]): number {
  // Moyenne circulaire sur 4θ pour être insensible aux quarts de tour.
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < points.length; i++) {
    const l = longueurCote(points, i);
    const r = residuQuartDeTour(angleCote(points, i));
    sx += l * Math.cos(4 * r);
    sy += l * Math.sin(4 * r);
  }
  return Math.atan2(sy, sx) / 4;
}

/**
 * Redresse les côtés presque alignés sur les axes de la pièce (à
 * `toleranceDeg` près) pour obtenir des angles droits exacts. Chaque côté
 * redressé pivote autour de son milieu ; les sommets sont recalculés à
 * l'intersection des côtés voisins. Les côtés franchement obliques sont
 * conservés.
 */
export function orthogonaliser(points: readonly Point[], toleranceDeg = 8): Point[] {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ ...p }));
  const base = orientationDominante(points);
  const tol = (toleranceDeg * Math.PI) / 180;
  const lignes = points.map((a, i) => {
    const b = suivant(points, i);
    const milieu = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const ecart = residuQuartDeTour(angle - base);
    const angleFinal = Math.abs(ecart) <= tol ? angle - ecart : angle;
    return { p: milieu, dir: { x: Math.cos(angleFinal), y: Math.sin(angleFinal) } };
  });
  return points.map((sommet, i) => {
    const avant = lignes[(i - 1 + n) % n];
    const apres = lignes[i];
    const inter = intersectionDroites(avant.p, avant.dir, apres.p, apres.dir);
    return inter ?? { ...sommet };
  });
}

/** Supprime les sommets doublons consécutifs et les sommets alignés (côtés colinéaires). */
export function simplifier(points: readonly Point[], toleranceCm = 0.5): Point[] {
  let pts = points.map((p) => ({ ...p }));
  let change = true;
  while (change && pts.length > 3) {
    change = false;
    for (let i = 0; i < pts.length; i++) {
      const a = precedent(pts, i);
      const b = pts[i];
      const c = suivant(pts, i);
      if (distance(a, b) < toleranceCm || distancePointSegment(b, a, c) < toleranceCm) {
        pts.splice(i, 1);
        change = true;
        break;
      }
    }
  }
  return pts;
}

export function arrondirPoint(p: Point, pas = 0.1): Point {
  return { x: Math.round(p.x / pas) * pas, y: Math.round(p.y / pas) * pas };
}
