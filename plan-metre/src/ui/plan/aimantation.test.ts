import { describe, expect, it } from 'vitest';
import { catalogueParDefaut } from '../../model/catalogue';
import { pieceRectangle } from '../../model/fabrique';
import { aimanterGrille, aimanterMurAMur, aimanterPointDessin, aimanterSommet, sommetsAimantables } from './aimantation';
import { deplacerPiece } from './operations';

const catalogue = catalogueParDefaut();
const opts = { cibles: [], toleranceCm: 12 };

describe('aimantation du tracé', () => {
  it('aimante le premier point sur la grille de 5 cm', () => {
    expect(aimanterGrille({ x: 12.4, y: -7.6 })).toEqual({ x: 10, y: -10 });
    expect(Object.is(aimanterGrille({ x: -1, y: 2 }).x, -0)).toBe(false);
    expect(aimanterPointDessin({ x: 12, y: 3 }, [], opts)).toMatchObject({ point: { x: 10, y: 5 }, type: 'grille' });
  });

  it('redresse le premier côté à l’horizontale et arrondit sa longueur', () => {
    const r = aimanterPointDessin({ x: 203, y: 9 }, [{ x: 0, y: 0 }], opts);
    expect(r).toMatchObject({ point: { x: 205, y: 0 }, type: 'angle', angle: 0 });
  });

  it('propose l’angle droit par rapport au côté précédent', () => {
    const trace = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    const r = aimanterPointDessin({ x: 208, y: 147 }, trace, opts);
    expect(r).toMatchObject({ point: { x: 200, y: 145 }, type: 'angle', angle: 90 });
  });

  it('propose 45°', () => {
    const r = aimanterPointDessin({ x: 100, y: 104 }, [{ x: 0, y: 0 }], opts);
    expect(r.type).toBe('angle');
    expect(r.angle).toBe(45);
    expect(r.point.x).toBeCloseTo(145 / Math.SQRT2, 3);
    expect(r.point.y).toBeCloseTo(145 / Math.SQRT2, 3);
  });

  it('laisse libre un angle quelconque (au-delà de 7°)', () => {
    const r = aimanterPointDessin({ x: 200, y: 50 }, [{ x: 0, y: 0 }], opts);
    expect(r).toMatchObject({ point: { x: 200, y: 50 }, type: 'grille' });
  });

  it('s’accroche aux sommets des autres pièces', () => {
    const r = aimanterPointDessin({ x: 305, y: 3 }, [{ x: 0, y: 0 }], { ...opts, cibles: [{ x: 301, y: 1 }] });
    expect(r).toMatchObject({ point: { x: 301, y: 1 }, type: 'sommet' });
  });

  it('referme le tracé sur le premier point dès 3 points', () => {
    const trace = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
    ];
    expect(aimanterPointDessin({ x: 6, y: -4 }, trace, opts)).toMatchObject({ point: { x: 0, y: 0 }, ferme: true });
    expect(aimanterPointDessin({ x: 6, y: -4 }, trace.slice(0, 2), opts).ferme).toBeUndefined();
  });

  it('s’aligne sur le premier point pour refermer d’équerre', () => {
    const trace = [
      { x: 0.7, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
    ];
    const r = aimanterPointDessin({ x: 3, y: 298 }, trace, opts);
    expect(r).toMatchObject({ point: { x: 0.7, y: 300 }, type: 'alignement' });
  });

  it('liste les sommets intérieurs et extérieurs des autres pièces', () => {
    const a = pieceRectangle('A', 400, 300);
    const b = pieceRectangle('B', 100, 100, { origine: { x: 600, y: 0 } });
    const cibles = sommetsAimantables([a, b], catalogue, b.id);
    expect(cibles).toHaveLength(8);
    expect(cibles.some((c) => Math.abs(c.x - 409.8) < 1e-9 && Math.abs(c.y - 309.8) < 1e-9)).toBe(true);
  });
});

describe('aimantation d’un sommet déplacé', () => {
  const s = pieceRectangle('A', 400, 300).sommets;

  it('s’aligne sur les sommets adjacents', () => {
    expect(aimanterSommet({ x: 405, y: 297 }, s, 2, [], 12)).toMatchObject({ point: { x: 400, y: 300 }, type: 'alignement' });
    expect(aimanterSommet({ x: 452, y: 296 }, s, 2, [], 12).point).toEqual({ x: 450, y: 300 });
  });

  it('se cale sur la grille sinon, ou sur le sommet d’une autre pièce', () => {
    expect(aimanterSommet({ x: 452, y: 213 }, s, 2, [], 12)).toMatchObject({ point: { x: 450, y: 215 }, type: 'grille' });
    expect(aimanterSommet({ x: 452, y: 213 }, s, 2, [{ x: 455, y: 210 }], 12).point).toEqual({ x: 455, y: 210 });
  });
});

describe('aimantation mur à mur', () => {
  const a = pieceRectangle('A', 400, 300);

  it('cale une pièce contre la face extérieure du mur voisin', () => {
    const b = pieceRectangle('B', 300, 300, { origine: { x: 400 + 9.8 + 7, y: 20 } });
    const c = aimanterMurAMur(b, [a], catalogue);
    expect(c.x).toBeCloseTo(-7, 6);
    expect(c.y).toBeCloseTo(0, 6);
    // Approche par la gauche, depuis l'intérieur du mur.
    const b2 = deplacerPiece(b, -12, 0);
    expect(aimanterMurAMur(b2, [a], catalogue).x).toBeCloseTo(5, 6);
  });

  it('se cale sur l’épaisseur du mur de l’autre pièce, quel que soit le sien', () => {
    const b = pieceRectangle('B', 300, 300, { origine: { x: 420, y: 0 }, typeMurDefautId: 'mur-parpaing-20' });
    const a2 = { ...a, typeMurDefautId: 'cloison-72' };
    expect(aimanterMurAMur(b, [a2], catalogue).x).toBeCloseTo(-(420 - 407.2), 6);
  });

  it('ignore une pièce trop loin ou décalée le long du mur', () => {
    const loin = pieceRectangle('B', 300, 300, { origine: { x: 440, y: 0 } });
    expect(aimanterMurAMur(loin, [a], catalogue)).toEqual({ x: 0, y: 0 });
    const decalee = pieceRectangle('B', 300, 300, { origine: { x: 415, y: 400 } });
    expect(aimanterMurAMur(decalee, [a], catalogue)).toEqual({ x: 0, y: 0 });
  });

  it('se cale dans un angle entre deux pièces', () => {
    const e = pieceRectangle('E', 300, 200, { origine: { x: 412, y: -200 } });
    const b = pieceRectangle('B', 300, 300, { origine: { x: 409.8 + 3, y: 9.8 + 4 } });
    const c = aimanterMurAMur(b, [a, e], catalogue);
    expect(c.x).toBeCloseTo(-3, 6);
    expect(c.y).toBeCloseTo(-4, 6);
  });
});
