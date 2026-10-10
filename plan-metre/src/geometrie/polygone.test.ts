import { describe, expect, it } from 'vitest';
import {
  aire,
  aireSignee,
  angleCote,
  contientPoint,
  decalerVersExterieur,
  decouperParConvexe,
  distance,
  orthogonaliser,
  perimetre,
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
