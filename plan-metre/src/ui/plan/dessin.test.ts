import { describe, expect, it } from 'vitest';
import { catalogueParDefaut } from '../../model/catalogue';
import { nouvelEquipement, nouvelleOuverture, pieceRectangle } from '../../model/fabrique';
import type { Ouverture } from '../../model/types';
import { angleLisible, cheminFerme, couleurSol, geometrieOuverture, pointDeSelection } from './dessin';

const catalogue = catalogueParDefaut();

function avecOuverture(o: Partial<Ouverture> & Pick<Ouverture, 'type'>) {
  const p = pieceRectangle('Chambre', 400, 300);
  const ouverture = { ...nouvelleOuverture(o.type, 0, 100, { largeur: 80 }), ...o };
  p.ouvertures = [ouverture];
  return { piece: p, ouverture };
}

describe('dessin du plan', () => {
  it('écrit un chemin fermé', () => {
    expect(
      cheminFerme([
        { x: 0, y: 0 },
        { x: 10.5, y: 0 },
        { x: 10.5, y: 1 / 3 },
      ]),
    ).toBe('M0 0L10.5 0L10.5 0.333Z');
    expect(cheminFerme([])).toBe('');
  });

  it('n’écrit jamais une cote à l’envers', () => {
    expect(angleLisible(0)).toBe(0);
    expect(angleLisible(90)).toBe(90);
    expect(angleLisible(-90)).toBe(90);
    expect(angleLisible(180)).toBe(0);
    expect(angleLisible(-180)).toBe(0);
    expect(angleLisible(135)).toBe(-45);
    expect(angleLisible(-135)).toBe(45);
    expect(angleLisible(270)).toBe(90);
  });

  it('colore le sol selon le revêtement', () => {
    const p = pieceRectangle('Séjour', 100, 100);
    expect(couleurSol(p, catalogue)).toBe('#ffffff');
    p.revetementSolId = 'parquet';
    expect(couleurSol(p, catalogue)).toBe('#c89f6d');
  });

  it('dessine une porte qui ouvre vers l’intérieur, charnière au début', () => {
    const { piece, ouverture } = avecOuverture({ type: 'porte' });
    const g = geometrieOuverture(piece, ouverture, catalogue, 0)!;
    // Le haut de la pièce est le côté y = 0 : l'intérieur est vers y > 0.
    expect(g.vantaux).toEqual([[{ x: 100, y: 0 }, { x: 100, y: 80 }]]);
    expect(g.arcs).toEqual([{ depart: { x: 100, y: 80 }, arrivee: { x: 180, y: 0 }, rayon: 80, sens: 0 }]);
    expect(g.decoupe).toHaveLength(4);
  });

  it('dessine une porte qui ouvre vers l’extérieur, charnière à la fin', () => {
    const { piece, ouverture } = avecOuverture({ type: 'porte', versInterieur: false, charniere: 'fin' });
    const g = geometrieOuverture(piece, ouverture, catalogue, 0)!;
    const [h, bout] = g.vantaux[0];
    expect(h.x).toBeCloseTo(180, 6);
    expect(h.y).toBeCloseTo(-9.8, 6);
    expect(bout.y).toBeCloseTo(-89.8, 6);
    expect(g.arcs[0].sens).toBe(0);
  });

  it('dessine fenêtres (double trait), baies (triple trait) et passages (vide)', () => {
    const fenetre = avecOuverture({ type: 'fenetre' });
    expect(geometrieOuverture(fenetre.piece, fenetre.ouverture, catalogue)!.traits).toHaveLength(2 + 2);
    const baie = avecOuverture({ type: 'baie' });
    expect(geometrieOuverture(baie.piece, baie.ouverture, catalogue)!.traits).toHaveLength(3 + 2);
    const passage = avecOuverture({ type: 'passage' });
    const g = geometrieOuverture(passage.piece, passage.ouverture, catalogue)!;
    expect(g.traits).toHaveLength(2);
    expect(g.vantaux).toHaveLength(0);
    const pf = avecOuverture({ type: 'porte-fenetre' });
    expect(geometrieOuverture(pf.piece, pf.ouverture, catalogue)!.vantaux).toHaveLength(2);
  });

  it('donne le point à garder visible pour chaque sélection', () => {
    const { piece, ouverture } = avecOuverture({ type: 'porte' });
    piece.equipements = [{ ...nouvelEquipement('wc', { x: 30, y: 40 }), id: 'wc' }];
    const plan = { pieces: [piece] };
    const id = piece.id;
    expect(pointDeSelection({ type: 'piece', pieceId: id }, plan, [])).toEqual({ x: 200, y: 150 });
    expect(pointDeSelection({ type: 'cote', pieceId: id, index: 1 }, plan, [])).toEqual({ x: 400, y: 150 });
    expect(pointDeSelection({ type: 'sommet', pieceId: id, index: 2 }, plan, [])).toMatchObject({ x: 400, y: 300 });
    expect(pointDeSelection({ type: 'ouverture', pieceId: id, ouvertureId: ouverture.id }, plan, [])).toEqual({ x: 140, y: 0 });
    expect(pointDeSelection({ type: 'equipement', pieceId: id, equipementId: 'wc' }, plan, [])).toEqual({ x: 30, y: 40 });
    expect(pointDeSelection({ type: 'piece', pieceId: 'absente' }, plan, [])).toBeNull();
  });

  it('ignore une ouverture dont le côté n’existe plus', () => {
    const { piece, ouverture } = avecOuverture({ type: 'porte', cote: 9 });
    expect(geometrieOuverture(piece, ouverture, catalogue)).toBeNull();
  });
});
