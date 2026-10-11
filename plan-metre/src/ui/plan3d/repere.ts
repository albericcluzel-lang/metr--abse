// Repère de la vue 3D et cadrage de la caméra (logique pure, sans WebGL).
//
// Passage du plan (cm, x vers la droite, y vers le bas) à la scène (m, Y vertical) :
//
//   point (x, y) du plan, à la hauteur h (cm)  →  (x / 100, h / 100, y / 100)
//
// Vu de dessus (caméra en +Y, haut de l'écran vers −Z), on retrouve le plan 2D
// tel quel : x vers la droite, y (= z de la scène) vers le bas. Pas de miroir.

import { Box3, Vector3 } from 'three';
import type { Point } from '../../model/types';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Point du plan (cm) à la hauteur `hauteurCm` → point de la scène (m). */
export function versScene(p: Point, hauteurCm = 0): Point3 {
  return { x: p.x / 100, y: hauteurCm / 100, z: p.y / 100 };
}

/** Point de la scène (m) → point du plan (cm), la hauteur est ignorée. */
export function versPlan(p: Point3): Point {
  return { x: p.x * 100, y: p.z * 100 };
}

/** Direction horizontale du plan (sans unité) → direction de la scène. */
export function directionVersScene(d: Point): Point3 {
  return { x: d.x, y: 0, z: d.y };
}

/**
 * Rotation d'un équipement (degrés, sens horaire à l'écran) → angle de
 * rotation autour de l'axe Y de la scène (radians, sens trigonométrique vu de
 * dessus). Le signe s'inverse parce que l'axe y du plan descend.
 */
export function rotationVersScene(rotationDeg: number): number {
  return -(rotationDeg * Math.PI) / 180;
}

/** Direction (depuis la cible) de la vue d'ensemble : 3/4 plongeante (≈ 50°), depuis le bas du plan, un peu à gauche. */
export const DIRECTION_VUE: Readonly<Point3> = { x: -0.45, y: 1.3, z: 1 };
/** Même vue, plus plongeante (≈ 60°), pour un écran en hauteur. */
export const DIRECTION_VUE_PORTRAIT: Readonly<Point3> = { x: -0.4, y: 1.9, z: 1 };

export interface Cadrage {
  position: Vector3;
  cible: Vector3;
  /** Distance caméra – cible (m). */
  distance: number;
}

/**
 * Position de caméra (perspective) qui fait tenir toute la boîte à l'écran,
 * vue selon `direction`. `marge` > 1 laisse de l'air autour (1,15 = 15 %).
 * Le calcul est exact : chaque coin de la boîte est ramené dans le cône de vue.
 */
export function calculerCadrage(
  boite: Box3,
  aspect: number,
  fovVerticalDeg: number,
  options: { direction?: Point3; marge?: number } = {},
): Cadrage {
  const d = options.direction ?? DIRECTION_VUE;
  const marge = options.marge ?? 1.15;
  const direction = new Vector3(d.x, d.y, d.z).normalize();
  if (boite.isEmpty()) {
    const distance = 6;
    return { cible: new Vector3(), position: direction.multiplyScalar(distance), distance };
  }
  const cible = boite.getCenter(new Vector3());
  const avant = direction.clone().negate();
  const droite = new Vector3().crossVectors(avant, new Vector3(0, 1, 0));
  if (droite.lengthSq() < 1e-9) droite.set(1, 0, 0);
  droite.normalize();
  const haut = new Vector3().crossVectors(droite, avant).normalize();
  const tanV = Math.tan((fovVerticalDeg * Math.PI) / 360) / marge;
  const tanH = (Math.tan((fovVerticalDeg * Math.PI) / 360) * Math.max(aspect, 1e-3)) / marge;
  let distance = 0;
  const coin = new Vector3();
  for (let i = 0; i < 8; i++) {
    coin.set(i & 1 ? boite.max.x : boite.min.x, i & 2 ? boite.max.y : boite.min.y, i & 4 ? boite.max.z : boite.min.z);
    coin.sub(cible);
    const x = coin.dot(droite);
    const y = coin.dot(haut);
    const z = coin.dot(avant);
    distance = Math.max(distance, Math.abs(x) / tanH - z, Math.abs(y) / tanV - z);
  }
  distance = Math.max(distance, 0.5);
  return { cible, position: cible.clone().addScaledVector(direction, distance), distance };
}
