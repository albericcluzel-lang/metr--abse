import { describe, expect, it } from 'vitest';
import {
  cadrer,
  cheminSvg,
  estPolygoneSimple,
  retirerAnglesPlats,
  segmentsSeCoupent,
  virageAuSommet,
} from './geometrieReleve';

const carre = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('segmentsSeCoupent', () => {
  it('détecte un croisement franc', () => {
    expect(segmentsSeCoupent({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
  });
  it('ignore des segments disjoints ou parallèles', () => {
    expect(segmentsSeCoupent({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
    expect(segmentsSeCoupent({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 0 })).toBe(false);
  });
  it('détecte un contact et un recouvrement alignés', () => {
    expect(segmentsSeCoupent({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 8 })).toBe(true);
    expect(segmentsSeCoupent({ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 4, y: 0 }, { x: 9, y: 0 })).toBe(true);
  });
});

describe('estPolygoneSimple', () => {
  it('accepte un carré, un triangle et une pièce en L', () => {
    expect(estPolygoneSimple(carre)).toBe(true);
    expect(estPolygoneSimple(carre.slice(0, 3))).toBe(true);
    const l = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ];
    expect(estPolygoneSimple(l)).toBe(true);
    expect(estPolygoneSimple([...l].reverse())).toBe(true);
  });
  it('refuse un nœud papillon, un demi-tour et un côté nul', () => {
    expect(
      estPolygoneSimple([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ]),
    ).toBe(false);
    expect(
      estPolygoneSimple([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ]),
    ).toBe(false);
    expect(estPolygoneSimple([carre[0], carre[1], carre[1], carre[2], carre[3]])).toBe(false);
    expect(estPolygoneSimple(carre.slice(0, 2))).toBe(false);
  });
});

describe('retirerAnglesPlats', () => {
  it('supprime un angle posé au milieu d’un mur', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 200, y: 3 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];
    const r = retirerAnglesPlats(pts, 8);
    expect(r).toHaveLength(4);
    expect(r).not.toContainEqual({ x: 200, y: 3 });
  });
  it('supprime les sommets confondus et garde les vrais angles', () => {
    const r = retirerAnglesPlats([carre[0], { x: 0.2, y: 0 }, ...carre.slice(1)], 8);
    expect(r).toHaveLength(4);
    expect(retirerAnglesPlats(carre, 8)).toEqual(carre);
  });
  it('mesure le virage au sommet', () => {
    expect(virageAuSommet({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(Math.PI / 2);
    expect(virageAuSommet({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -10 })).toBeCloseTo(-Math.PI / 2);
  });
});

describe('cadrage des aperçus', () => {
  it('centre et met à l’échelle sans déformer', () => {
    const c = cadrer(carre, 300, 200, 20, 10);
    expect(c.echelle).toBeCloseTo(1.6);
    expect(c.transformer({ x: 50, y: 50 })).toEqual({ x: 150, y: 100 });
    expect(c.transformer({ x: 0, y: 0 }).y).toBeCloseTo(20);
  });
  it('plafonne l’échelle d’un dessin minuscule ou vide', () => {
    expect(cadrer([{ x: 5, y: 5 }], 100, 100, 10, 2).echelle).toBe(2);
    expect(cadrer([], 100, 80).transformer({ x: 0, y: 0 })).toEqual({ x: 50, y: 40 });
  });
  it('écrit un chemin SVG', () => {
    expect(cheminSvg(carre.slice(0, 2), false)).toBe('M0 0 L100 0');
    expect(cheminSvg([{ x: 1.26, y: 2 }], true)).toBe('M1.3 2 Z');
    expect(cheminSvg([], true)).toBe('');
  });
});
