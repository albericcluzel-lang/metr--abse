// Accumulation de triangles à facettes (normales franches) pour la vue 3D.
//
// Chaque face est donnée avec la normale voulue ; l'ordre des sommets est
// corrigé au besoin pour que la face soit visible du bon côté. On évite ainsi
// les murs ou sols « retournés » quel que soit le sens de saisie des contours.

import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { aireSignee } from '../../geometrie/polygone';
import type { Point } from '../../model/types';
import { versScene, type Point3 } from './repere';

export const VERS_LE_HAUT: Readonly<Point3> = { x: 0, y: 1, z: 0 };
export const VERS_LE_BAS: Readonly<Point3> = { x: 0, y: -1, z: 0 };

/** Normale extérieure horizontale (scène) du bord a → b d'un contour du plan de sens `sens` (signe de l'aire). */
export function normaleBord(a: Point, b: Point, sens: number): Point3 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: (sens * dy) / l, y: 0, z: (-sens * dx) / l };
}

export class Tampon {
  readonly positions: number[] = [];
  readonly normales: number[] = [];

  get vide(): boolean {
    return this.positions.length === 0;
  }

  /** Nombre de triangles accumulés. */
  get nombreTriangles(): number {
    return this.positions.length / 9;
  }

  triangle(a: Point3, b: Point3, c: Point3, n: Point3): void {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < 1e-12) return; // triangle dégénéré
    const ordre = cx * n.x + cy * n.y + cz * n.z >= 0 ? [a, b, c] : [a, c, b];
    for (const p of ordre) {
      this.positions.push(p.x, p.y, p.z);
      this.normales.push(n.x, n.y, n.z);
    }
  }

  /** Polygone plan et convexe (éventail de triangles). */
  polygone(points: readonly Point3[], n: Point3): void {
    for (let i = 1; i + 1 < points.length; i++) this.triangle(points[0], points[i], points[i + 1], n);
  }

  quad(a: Point3, b: Point3, c: Point3, d: Point3, n: Point3): void {
    this.polygone([a, b, c, d], n);
  }

  /** Face horizontale quelconque (concave, avec trous) à la hauteur `hauteurCm`. Contours en cm, repère du plan. */
  faceHorizontale(contour: readonly Point[], trous: readonly (readonly Point[])[], hauteurCm: number, n: Point3): void {
    if (contour.length < 3) return;
    const exterieur = contour.map((p) => new Vector2(p.x, p.y));
    const interieurs = trous.map((t) => t.map((p) => new Vector2(p.x, p.y)));
    // triangulateShape retire sur place un dernier point répétant le premier :
    // les indices renvoyés se lisent donc dans les tableaux après l'appel.
    const faces = ShapeUtils.triangulateShape(exterieur, interieurs);
    const tous = [...exterieur, ...interieurs.flat()].map((v) => versScene({ x: v.x, y: v.y }, hauteurCm));
    for (const [i, j, k] of faces) this.triangle(tous[i], tous[j], tous[k], n);
  }

  /** Paroi verticale le long du bord a → b, entre deux hauteurs (cm). */
  paroi(a: Point, b: Point, bas: number, haut: number, n: Point3): void {
    if (haut - bas <= 1e-6) return;
    this.quad(versScene(a, bas), versScene(b, bas), versScene(b, haut), versScene(a, haut), n);
  }

  /**
   * Prisme droit d'emprise `contour` (cm, repère du plan, éventuellement avec
   * trous) entre les hauteurs `bas` et `haut` (cm).
   */
  prisme(
    contour: readonly Point[],
    bas: number,
    haut: number,
    options: { trous?: readonly (readonly Point[])[]; dessus?: boolean; dessous?: boolean } = {},
  ): void {
    if (contour.length < 3 || haut - bas <= 1e-6) return;
    const trous = options.trous ?? [];
    if (options.dessus !== false) this.faceHorizontale(contour, trous, haut, VERS_LE_HAUT);
    if (options.dessous) this.faceHorizontale(contour, trous, bas, VERS_LE_BAS);
    const anneaux: Array<{ points: readonly Point[]; exterieur: boolean }> = [
      { points: contour, exterieur: true },
      ...trous.map((t) => ({ points: t, exterieur: false })),
    ];
    for (const { points, exterieur } of anneaux) {
      // La matière est à l'intérieur du contour et à l'extérieur des trous.
      const sens = (aireSignee(points) >= 0 ? 1 : -1) * (exterieur ? 1 : -1);
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        this.paroi(a, b, bas, haut, normaleBord(a, b, sens));
      }
    }
  }

  geometrie(): BufferGeometry {
    return fusionner([this]);
  }
}

/**
 * Réunit plusieurs tampons dans une géométrie, un groupe par tampon :
 * le tampon d'indice i utilise le matériau d'indice i du maillage.
 */
export function fusionner(tampons: readonly Tampon[]): BufferGeometry {
  const positions: number[] = [];
  const normales: number[] = [];
  const geo = new BufferGeometry();
  tampons.forEach((t, i) => {
    const debut = positions.length / 3;
    for (const v of t.positions) positions.push(v);
    for (const v of t.normales) normales.push(v);
    const nombre = positions.length / 3 - debut;
    if (nombre > 0) geo.addGroup(debut, nombre, i);
  });
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normales, 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
