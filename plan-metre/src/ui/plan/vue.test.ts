import { describe, expect, it } from 'vitest';
import { catalogueParDefaut } from '../../model/catalogue';
import { pieceRectangle } from '../../model/fabrique';
import { ajusterVue, boitePlan, ECHELLE_MAX, pasGrille, pincer, versEcran, versPlan, zoomer, type Vue } from './vue';

const sansMarge = { haut: 0, droite: 0, bas: 0, gauche: 0 };

describe('vue du plan', () => {
  const v: Vue = { echelle: 0.5, tx: 100, ty: 40 };

  it('passe du plan à l’écran et retour', () => {
    expect(versEcran(v, { x: 200, y: 100 })).toEqual({ x: 200, y: 90 });
    expect(versPlan(v, { x: 200, y: 90 })).toEqual({ x: 200, y: 100 });
  });

  it('zoome autour d’un point fixe et borne l’échelle', () => {
    const centre = { x: 150, y: 70 };
    const z = zoomer(v, 2, centre);
    expect(z.echelle).toBe(1);
    expect(versPlan(z, centre)).toEqual(versPlan(v, centre));
    expect(zoomer(v, 1000, centre).echelle).toBe(ECHELLE_MAX);
  });

  it('pince : écarter double l’échelle, glisser déplace la vue', () => {
    const a0 = { x: 100, y: 100 };
    const b0 = { x: 200, y: 100 };
    const glisse = pincer(v, a0, b0, { x: 110, y: 120 }, { x: 210, y: 120 });
    expect(glisse).toEqual({ echelle: 0.5, tx: 110, ty: 60 });
    const ecarte = pincer(v, a0, b0, { x: 50, y: 100 }, { x: 250, y: 100 });
    expect(ecarte.echelle).toBe(1);
    expect(versPlan(ecarte, { x: 150, y: 100 })).toEqual(versPlan(v, { x: 150, y: 100 }));
  });

  it('ajuste la vue sur le contenu', () => {
    const boite = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    expect(ajusterVue(boite, 400, 300, sansMarge)).toEqual({ echelle: 1, tx: 0, ty: 0 });
    expect(ajusterVue(boite, 800, 300, sansMarge)).toEqual({ echelle: 1, tx: 200, ty: 0 });
    const avecMarges = ajusterVue(boite, 470, 380, { haut: 10, droite: 0, bas: 70, gauche: 70 });
    expect(avecMarges).toEqual({ echelle: 1, tx: 70, ty: 10 });
    // Petite pièce : on ne zoome pas au-delà de 3 px/cm.
    expect(ajusterVue({ minX: 0, minY: 0, maxX: 60, maxY: 60 }, 800, 800, sansMarge).echelle).toBe(3);
  });

  it('centre l’origine quand le plan est vide', () => {
    const vide = ajusterVue(null, 500, 1000, sansMarge);
    expect(vide).toEqual({ echelle: 1, tx: 250, ty: 500 });
  });

  it('mesure l’étendue d’un plan, murs compris', () => {
    const b = boitePlan({ pieces: [pieceRectangle('A', 400, 300)] }, catalogueParDefaut(), [{ x: -50, y: 0 }]);
    expect(b!.minX).toBe(-50);
    expect(b!.maxX).toBeCloseTo(409.8, 6);
    expect(b!.minY).toBeCloseTo(-9.8, 6);
    expect(boitePlan({ pieces: [] }, catalogueParDefaut())).toBeNull();
  });

  it('adapte le pas du quadrillage au zoom', () => {
    expect(pasGrille(1)).toEqual({ fin: 10, fort: 100 });
    expect(pasGrille(0.5)).toEqual({ fin: 100, fort: 1000 });
    expect(pasGrille(0.001)).toEqual({ fin: 1000, fort: 10000 });
  });
});
