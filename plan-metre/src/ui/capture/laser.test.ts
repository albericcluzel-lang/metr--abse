import { describe, expect, it } from 'vitest';
import { aire, aireSignee, perimetre } from '../../geometrie/polygone';
import {
  construirePolygoneLaser,
  directionCap,
  ECART_FUSION_CM,
  libelleVirage,
  tracerLaser,
  VIRAGE_DROITE,
  VIRAGE_GAUCHE,
  virageDepuisAngleInterieur,
  type CoteLaser,
} from './laser';

const D = VIRAGE_DROITE;
const G = VIRAGE_GAUCHE;
const cotes = (...c: [number, number][]): CoteLaser[] => c.map(([longueur, virage]) => ({ longueur, virage }));

describe('tracé au mètre laser', () => {
  it('part de l’origine vers la droite et tourne à droite dans le sens horaire (y vers le bas)', () => {
    const t = tracerLaser(cotes([400, D], [300, D]));
    expect(t.sommets).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
    expect(t.extremite).toEqual({ x: 400, y: 300 });
    expect(t.cap).toBe(180);
    expect(t.ecartFermeture).toBeCloseTo(500);
  });

  it('donne des directions exactes pour les quarts de tour', () => {
    expect(directionCap(90)).toEqual({ x: 0, y: 1 });
    expect(directionCap(-90)).toEqual({ x: 0, y: -1 });
    expect(directionCap(450)).toEqual({ x: 0, y: 1 });
    expect(directionCap(45).x).toBeCloseTo(Math.SQRT1_2);
  });

  it('trace vide : rien à fermer', () => {
    const t = tracerLaser([]);
    expect(t.sommets).toEqual([]);
    expect(t.ecartFermeture).toBe(0);
    expect(construirePolygoneLaser([]).valide).toBe(false);
  });
});

describe('construirePolygoneLaser', () => {
  it('rectangle 400 × 300 en tournant à droite : fermeture exacte', () => {
    const r = construirePolygoneLaser(cotes([400, D], [300, D], [400, D], [300, D]));
    expect(r.points).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ]);
    expect(r.ecartFermeture).toBe(0);
    expect(r.ecartImportant).toBe(false);
    expect(r.coteFermetureCalcule).toBe(false);
    expect(r.valide).toBe(true);
    expect(aire(r.points)).toBe(120000);
    expect(aireSignee(r.points)).toBeGreaterThan(0); // sens horaire à l'écran
  });

  it('le dernier virage saisi n’a pas d’effet sur la fermeture', () => {
    const a = construirePolygoneLaser(cotes([400, D], [300, D], [400, D], [300, 0]));
    expect(a.points).toHaveLength(4);
    expect(a.ecartFermeture).toBe(0);
  });

  it('dernier côté non mesuré : le segment de fermeture devient un côté calculé', () => {
    const r = construirePolygoneLaser(cotes([400, D], [300, D], [400, D]));
    expect(r.coteFermetureCalcule).toBe(true);
    expect(r.ecartFermeture).toBe(300);
    expect(r.points).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ]);
    expect(r.valide).toBe(true);
  });

  it('pièce en L avec un angle rentrant (virage à gauche)', () => {
    // 400 → bas 200 → gauche 200 (rentrant : on tourne à gauche) → bas 100 → 200 → 300 vers le haut
    const r = construirePolygoneLaser(cotes([400, D], [200, D], [200, G], [100, D], [200, D], [300, D]));
    expect(r.valide).toBe(true);
    expect(r.ecartFermeture).toBeCloseTo(0);
    expect(r.points).toHaveLength(6);
    expect(aire(r.points)).toBe(400 * 200 + 200 * 100);
    expect(perimetre(r.points)).toBe(1400);
  });

  it('angle libre : pan coupé à 135° (virage de 45°)', () => {
    const v = virageDepuisAngleInterieur(135);
    expect(v).toBe(45);
    const c = 100 * Math.SQRT2;
    // 400 × 300 dont l'angle bas-droit est coupé par un pan de 100 × 100.
    const r = construirePolygoneLaser(cotes([400, D], [200, v], [c, v], [300, D], [300, D]));
    expect(r.valide).toBe(true);
    expect(r.ecartFermeture).toBeLessThan(0.01);
    expect(r.points).toHaveLength(5);
    expect(r.points[3].x).toBeCloseTo(300);
    expect(r.points[3].y).toBeCloseTo(300);
    expect(aire(r.points)).toBeCloseTo(400 * 300 - (100 * 100) / 2, 0);
  });

  it('écart de fermeture : faible, important, ou côté non mesuré', () => {
    const faible = construirePolygoneLaser(cotes([400, D], [300, D], [402, D], [300, D]));
    expect(faible.ecartFermeture).toBeCloseTo(2);
    expect(faible.ecartImportant).toBe(false);
    expect(faible.points).toHaveLength(4);

    const important = construirePolygoneLaser(cotes([400, D], [300, D], [412, D], [300, D]));
    expect(important.ecartFermeture).toBeCloseTo(12);
    expect(important.ecartImportant).toBe(true);
    expect(important.coteFermetureCalcule).toBe(false);
    // Le dernier sommet rejoint le premier : le contour garde 4 sommets.
    expect(important.points).toHaveLength(4);

    const nonMesure = construirePolygoneLaser(cotes([400, D], [300, D], [400 + ECART_FUSION_CM + 10, D], [300, D]));
    expect(nonMesure.coteFermetureCalcule).toBe(true);
    expect(nonMesure.ecartImportant).toBe(false);
    expect(nonMesure.points).toHaveLength(5);
  });

  it('refuse les côtés qui se croisent ou une pièce plate', () => {
    // Virage à gauche au lieu de droite : le contour se croise.
    expect(construirePolygoneLaser(cotes([400, D], [300, G], [400, D], [300, D])).valide).toBe(false);
    // Deux côtés seulement, alignés : aucune surface.
    expect(construirePolygoneLaser(cotes([400, 0], [300, 0])).valide).toBe(false);
  });

  it('triangle : deux côtés et la fermeture', () => {
    const r = construirePolygoneLaser(cotes([300, D], [400, D]));
    expect(r.points).toHaveLength(3);
    expect(r.ecartFermeture).toBeCloseTo(500);
    expect(r.valide).toBe(true);
    expect(aire(r.points)).toBe(60000);
  });
});

describe('libellés des virages', () => {
  it('nomme le sens et l’angle', () => {
    expect(libelleVirage(90)).toBe('à droite de 90°');
    expect(libelleVirage(-45)).toBe('à gauche de 45°');
    expect(libelleVirage(270)).toBe('à gauche de 90°');
    expect(libelleVirage(0)).toBe('tout droit');
    expect(virageDepuisAngleInterieur(270)).toBe(-90);
  });
});
