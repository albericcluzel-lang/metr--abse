import { describe, expect, it } from 'vitest';
import { nouvelleOuverture, pieceRectangle } from '../../model/fabrique';
import type { Plan } from '../../model/types';
import { disposerTextes, seChevauchent } from './textes';
import { versEcran, type Vue } from './vue';

// Échelle d'un téléphone après le relevé de quelques pièces.
const vue: Vue = { echelle: 0.2326, tx: 20, ty: 30 };

function zoneCote(c: { x: number; y: number; angle: number; texte: string }) {
  const w = c.texte.length * 6.6;
  const vertical = Math.abs(Math.sin((c.angle * Math.PI) / 180)) > 0.5;
  const [hx, hy] = vertical ? [6.5, w / 2] : [w / 2, 6.5];
  return { x0: c.x - hx, y0: c.y - hy, x1: c.x + hx, y1: c.y + hy };
}

describe('disposition des textes du plan', () => {
  it('efface l’étiquette que recouvre la cote du côté sélectionné', () => {
    const cuisine = pieceRectangle('Cuisine', 350, 280);
    const plan: Plan = { pieces: [cuisine] };
    expect(disposerTextes(plan, vue, null).etiquettes).toHaveLength(1);
    const { etiquettes, cotes } = disposerTextes(plan, vue, { type: 'cote', pieceId: cuisine.id, index: 3 });
    const active = cotes.find((c) => c.active)!;
    expect(active.texte).toBe('280 cm');
    expect(etiquettes.every((et) => !seChevauchent(et.zone, zoneCote(active)))).toBe(true);
    // Sans sélection, c'est la cote qui s'efface devant l'étiquette.
    const libre = disposerTextes(plan, vue, null);
    for (const c of libre.cotes) expect(libre.etiquettes.some((et) => seChevauchent(et.zone, zoneCote(c)))).toBe(false);
  });

  it('limite l’étiquette à la largeur de la pièce : nom raccourci, puis surface seule', () => {
    const sdb = pieceRectangle('Salle de bain', 300, 180, { origine: { x: 600, y: 300 } });
    const [et] = disposerTextes({ pieces: [sdb] }, vue, null).etiquettes;
    expect(et.nom).toMatch(/^Salle.*…$/);
    const a = versEcran(vue, { x: 600, y: 300 });
    const b = versEcran(vue, { x: 900, y: 480 });
    expect(et.zone.x0).toBeGreaterThanOrEqual(a.x);
    expect(et.zone.x1).toBeLessThanOrEqual(b.x);
    // À grande échelle, le nom entier.
    expect(disposerTextes({ pieces: [sdb] }, { ...vue, echelle: 1 }, null).etiquettes[0].nom).toBe('Salle de bain');
    // Pièce trop étroite même pour la surface : pas d'étiquette.
    expect(disposerTextes({ pieces: [pieceRectangle('Placard', 150, 180)] }, vue, null).etiquettes).toHaveLength(0);
  });

  it('écarte la cote de l’arc d’une porte qui s’ouvre dans la pièce', () => {
    const salon = pieceRectangle('Salon', 500, 1000); // étiquette loin du mur du haut
    salon.ouvertures = [nouvelleOuverture('porte', 0, 208.5)]; // de 208,5 à 291,5
    const haut = (v: Vue) => disposerTextes({ pieces: [salon] }, v, null).cotes.find((c) => c.cle === `${salon.id}-0`);
    // Assez de place à côté de la porte : la cote glisse le long du mur.
    const grand = { echelle: 1, tx: 0, ty: 0 };
    const c1 = haut(grand)!;
    expect(c1.y).toBeCloseTo(13, 6);
    expect(c1.x + (c1.texte.length * 6.6) / 2).toBeLessThan(208.5);
    // Trop serré : la cote passe au-delà de l'arc (83 cm de rayon).
    const petit = { echelle: 0.2, tx: 0, ty: 0 };
    const c2 = disposerTextes({ pieces: [salon] }, petit, null).cotes.find((c) => c.cle === `${salon.id}-0`);
    expect(c2!.y - 6.5).toBeGreaterThan(83 * 0.2);
    // Une porte qui s'ouvre vers l'extérieur ne gêne pas.
    salon.ouvertures[0].versInterieur = false;
    expect(haut(grand)!.x).toBeCloseTo(250, 6);
  });
});
