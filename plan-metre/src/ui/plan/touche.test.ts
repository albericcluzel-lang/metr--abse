import { describe, expect, it } from 'vitest';
import { catalogueParDefaut } from '../../model/catalogue';
import { nouvelEquipement, nouvelleOuverture, pieceRectangle } from '../../model/fabrique';
import type { Plan } from '../../model/types';
import {
  coteSousPoint,
  equipementSousPoint,
  ouvertureSousPoint,
  pieceSousPoint,
  poigneeProche,
  poigneesMilieux,
  sommetProche,
} from './touche';

const catalogue = catalogueParDefaut();

function plan(): Plan {
  const sejour = pieceRectangle('Séjour', 400, 300);
  sejour.ouvertures = [{ ...nouvelleOuverture('porte', 0, 100), id: 'porte' }];
  const baignoire = { ...nouvelEquipement('baignoire', { x: 100, y: 150 }), id: 'bain', rotation: 90 };
  sejour.equipements = [baignoire];
  const placard = pieceRectangle('Placard', 100, 100, { origine: { x: 250, y: 150 } });
  return { pieces: [sejour, placard] };
}

describe('tests de touche', () => {
  it('trouve la pièce du dessus', () => {
    const p = plan();
    expect(pieceSousPoint(p, { x: 50, y: 50 })?.nom).toBe('Séjour');
    expect(pieceSousPoint(p, { x: 300, y: 200 })?.nom).toBe('Placard');
    expect(pieceSousPoint(p, { x: 500, y: 50 })).toBeNull();
  });

  it('trouve le côté dans l’épaisseur du mur ou juste à l’intérieur', () => {
    const p = plan();
    const sejour = p.pieces[0];
    expect(coteSousPoint(p, catalogue, { x: 200, y: -5 }, 5)).toEqual({ pieceId: sejour.id, index: 0, abscisse: 200 });
    expect(coteSousPoint(p, catalogue, { x: 200, y: 3 }, 5)?.index).toBe(0);
    expect(coteSousPoint(p, catalogue, { x: 404, y: 60 }, 5)).toMatchObject({ index: 1, abscisse: 60 });
    expect(coteSousPoint(p, catalogue, { x: 200, y: 100 }, 5)).toBeNull();
    expect(coteSousPoint(p, catalogue, { x: 200, y: -30 }, 5)).toBeNull();
  });

  it('préfère la pièce sélectionnée quand deux murs se superposent', () => {
    const p = plan();
    const placard = p.pieces[1];
    // Le mur haut du placard (y = 150) est au milieu du séjour : seul le placard répond.
    expect(coteSousPoint(p, catalogue, { x: 300, y: 147 }, 5)?.pieceId).toBe(placard.id);
    // Pièce calée « mur à mur » à droite du séjour : les deux bandes de mur se superposent.
    const sejour = p.pieces[0];
    const voisine = pieceRectangle('Chambre', 300, 300, { origine: { x: 409.8, y: 0 } });
    p.pieces.push(voisine);
    expect(coteSousPoint(p, catalogue, { x: 405, y: 100 }, 5)?.pieceId).toBe(sejour.id);
    expect(coteSousPoint(p, catalogue, { x: 405, y: 100 }, 5, voisine.id)).toMatchObject({ pieceId: voisine.id, index: 3 });
  });

  it('trouve une ouverture sur son mur', () => {
    const p = plan();
    expect(ouvertureSousPoint(p, catalogue, { x: 140, y: -4 }, 5)).toMatchObject({ ouvertureId: 'porte', abscisse: 140 });
    expect(ouvertureSousPoint(p, catalogue, { x: 300, y: -4 }, 5)).toBeNull();
  });

  it('trouve un équipement tourné', () => {
    const p = plan();
    expect(equipementSousPoint(p, { x: 100, y: 230 }, 0)?.equipementId).toBe('bain');
    expect(equipementSousPoint(p, { x: 160, y: 150 }, 0)).toBeNull();
    expect(equipementSousPoint(p, { x: 136, y: 150 }, 2)?.equipementId).toBe('bain');
  });

  it('trouve sommets et poignées « + » (au-delà du mur)', () => {
    const piece = plan().pieces[0];
    expect(sommetProche(piece.sommets, { x: 395, y: 6 }, 10)).toBe(1);
    expect(sommetProche(piece.sommets, { x: 380, y: 20 }, 10)).toBe(-1);
    // Échelle 1 px/cm, repère écran = repère plan.
    const poignees = poigneesMilieux(piece, catalogue, (p) => p, 1, 150, 15);
    expect(poignees[0]!.x).toBeCloseTo(200, 6);
    expect(poignees[0]!.y).toBeCloseTo(-9.8 - 15, 6);
    expect(poignees[1]!.x).toBeCloseTo(400 + 9.8 + 15, 6);
    expect(poigneeProche(poignees, { x: 205, y: -20 }, 18)).toBe(0);
    expect(poigneeProche(poignees, { x: 200, y: 2 }, 18)).toBe(-1);
    // Côtés trop courts à l'écran : pas de poignée.
    expect(poigneesMilieux(piece, catalogue, (p) => p, 0.3, 150).every((q) => q === null)).toBe(true);
  });
});
