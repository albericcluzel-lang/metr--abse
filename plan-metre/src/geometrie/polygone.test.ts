import { describe, expect, it } from 'vitest';
import {
  aire,
  aireSignee,
  angleCote,
  contientPoint,
  decalerVersExterieur,
  decouperParConvexe,
  distance,
  facesExterieures,
  orthogonaliser,
  perimetre,
  perimetreDecale,
  pointEtiquette,
  simplifier,
  tourner,
} from './polygone';

const carre = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('polygone', () => {
  it('calcule aire et périmètre', () => {
    expect(aire(carre)).toBe(10000);
    expect(aireSignee(carre)).toBeGreaterThan(0);
    expect(aireSignee([...carre].reverse())).toBeLessThan(0);
    expect(perimetre(carre)).toBe(400);
  });

  it('teste l’appartenance', () => {
    expect(contientPoint(carre, { x: 50, y: 50 })).toBe(true);
    expect(contientPoint(carre, { x: 150, y: 50 })).toBe(false);
  });

  it('décale vers l’extérieur dans les deux sens de parcours', () => {
    for (const pts of [carre, [...carre].reverse()]) {
      const ext = decalerVersExterieur(pts, [10, 10, 10, 10]);
      expect(perimetre(ext)).toBeCloseTo(480, 6);
      expect(aire(ext)).toBeCloseTo(14400, 6);
    }
  });

  it('place l’étiquette à l’intérieur d’une pièce en U', () => {
    const u = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 200 },
      { x: 140, y: 200 },
      { x: 140, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 260 },
      { x: 0, y: 260 },
    ];
    expect(contientPoint(u, pointEtiquette(u))).toBe(true);
  });

  it('découpe par un rectangle', () => {
    const rect = [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 50, y: 150 },
    ];
    expect(aire(decouperParConvexe(carre, rect))).toBeCloseTo(2500, 6);
    expect(aire(decouperParConvexe(carre, [...rect].reverse()))).toBeCloseTo(2500, 6);
  });

  it('orthogonalise un relevé approximatif, même tourné', () => {
    const releve = [
      { x: 0, y: 0 },
      { x: 402, y: 6 },
      { x: 398, y: 303 },
      { x: -3, y: 297 },
    ];
    for (const angle of [0, 0.4, -1.1]) {
      const pts = releve.map((p) => tourner(p, angle));
      const o = orthogonaliser(pts, 8);
      for (let i = 0; i < 4; i++) {
        const a1 = angleCote(o, i);
        const a2 = angleCote(o, (i + 1) % 4);
        let delta = Math.abs(a2 - a1) % Math.PI;
        if (delta > Math.PI / 2) delta = Math.PI - delta;
        expect(delta).toBeCloseTo(Math.PI / 2, 6);
      }
      expect(aire(o)).toBeGreaterThan(0.97 * aire(pts));
      expect(aire(o)).toBeLessThan(1.03 * aire(pts));
    }
  });

  it('conserve un côté franchement oblique', () => {
    const pan = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 400, y: 100 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];
    const o = orthogonaliser(pan, 8);
    expect(distance(o[1], pan[1])).toBeLessThan(1e-6);
    expect(distance(o[2], pan[2])).toBeLessThan(1e-6);
  });

  it('supprime les sommets alignés et doublons', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0.1 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(simplifier(pts)).toHaveLength(4);
  });
});

describe('contour extérieur : retours d’about et biseaux', () => {
  it('demi-mur suivi d’un côté sans mur : retour d’about au lieu d’une diagonale', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];
    const ep = [9.8, 0, 9.8, 9.8, 9.8];
    const f = facesExterieures(pts, ep);
    expect(f[0].fin).toEqual({ x: 200, y: -9.8 });
    expect(f[1].debut.y).toBeCloseTo(0, 9);
    expect(perimetreDecale(pts, ep)).toBeCloseTo(209.8 + 9.8 + 209.8 + 309.8 + 419.6 + 319.6, 6);
    expect(decalerVersExterieur(pts, ep)).toHaveLength(6);
  });

  it('épaisseurs différentes sur deux côtés alignés : retour égal à la différence', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];
    const f = facesExterieures(pts, [20, 9.8, 9.8, 9.8, 9.8]);
    expect(distance(f[0].fin, f[1].debut)).toBeCloseTo(10.2, 9);
  });

  it('angle aigu de 25° : onglet complet, pas de plafonnement à 4 épaisseurs', () => {
    const h = 600 * Math.tan((25 * Math.PI) / 180);
    const tri = [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 0, y: h },
    ];
    const ep = [9.8, 9.8, 9.8];
    const f = facesExterieures(tri, ep);
    // Les trois jonctions sont des onglets.
    for (let i = 0; i < 3; i++) expect(distance(f[i].fin, f[(i + 1) % 3].debut)).toBeLessThan(1e-9);
    expect(perimetreDecale(tri, ep)).toBeCloseTo(perimetre(decalerVersExterieur(tri, ep)), 6);
  });

  it('bout de refend plus étroit que deux épaisseurs : compté pour zéro', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 150 },
      { x: 255, y: 150 },
      { x: 255, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 400 },
      { x: 0, y: 400 },
    ];
    const ep = pts.map(() => 9.8);
    const f = facesExterieures(pts, ep);
    const u = { x: 1, y: 0 };
    expect((f[2].fin.x - f[2].debut.x) * u.x).toBeLessThan(0); // face du bout retournée
    expect(perimetreDecale(pts, ep)).toBeLessThan(perimetre(decalerVersExterieur(pts, ep)));
  });
});
