import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Tampon, VERS_LE_HAUT } from './tampon';

function aireEtOrientation(t: Tampon) {
  let aire = 0;
  for (let i = 0; i < t.positions.length; i += 9) {
    const p = t.positions;
    const a = new Vector3(p[i], p[i + 1], p[i + 2]);
    const b = new Vector3(p[i + 3], p[i + 4], p[i + 5]);
    const c = new Vector3(p[i + 6], p[i + 7], p[i + 8]);
    const n = new Vector3(t.normales[i], t.normales[i + 1], t.normales[i + 2]);
    const croix = b.sub(a).cross(c.sub(a));
    expect(croix.dot(n)).toBeGreaterThan(0);
    aire += croix.length() / 2;
  }
  return aire;
}

describe('tampon de facettes', () => {
  it('face horizontale avec trou, contour fermé (premier point répété) : aire juste', () => {
    const t = new Tampon();
    const carre = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
      { x: 0, y: 0 },
    ];
    const trou = [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 50, y: 150 },
    ];
    t.faceHorizontale(carre, [trou], 0, VERS_LE_HAUT);
    expect(aireEtOrientation(t)).toBeCloseTo(4 - 1, 9); // m²
  });

  it('prisme : faces visibles de l’extérieur quel que soit le sens du contour', () => {
    for (const sens of [1, -1]) {
      const t = new Tampon();
      const pts = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 0, y: 50 },
      ];
      t.prisme(sens > 0 ? pts : [...pts].reverse(), 0, 100, { dessous: true });
      // 2 × (1 × 0,5) + 2 × (1 × 1) + 2 × (0,5 × 1) = 4 m²
      expect(aireEtOrientation(t)).toBeCloseTo(4, 9);
      // Normales des parois vers l'extérieur : depuis le centre, elles s'éloignent.
      for (let i = 0; i < t.positions.length; i += 9) {
        const centre = new Vector3(
          (t.positions[i] + t.positions[i + 3] + t.positions[i + 6]) / 3 - 0.5,
          (t.positions[i + 1] + t.positions[i + 4] + t.positions[i + 7]) / 3 - 0.5,
          (t.positions[i + 2] + t.positions[i + 5] + t.positions[i + 8]) / 3 - 0.25,
        );
        const n = new Vector3(t.normales[i], t.normales[i + 1], t.normales[i + 2]);
        expect(centre.dot(n)).toBeGreaterThan(0);
      }
    }
  });

  it('ignore les triangles dégénérés', () => {
    const t = new Tampon();
    t.triangle({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, VERS_LE_HAUT);
    expect(t.vide).toBe(true);
  });
});
