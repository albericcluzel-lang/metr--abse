import { describe, expect, it } from 'vitest';
import { nouvelEquipement, nouvelleOuverture, nouvellePiece, pieceRectangle } from '../../model/fabrique';
import type { Piece } from '../../model/types';
import { aire, longueurCote } from '../../geometrie/polygone';
import {
  changerLongueurCote,
  changerTypeEquipement,
  changerTypeOuverture,
  deplacerPiece,
  deplacerSommet,
  insererSommet,
  orthogonaliserPiece,
  ouvertureSurCote,
  placerEquipement,
  seCroise,
  supprimerSommet,
  transfererEquipement,
} from './operations';

/** Séjour 400 × 300 : porte et fenêtre sur le côté du haut, fenêtre sur le côté du bas. */
function sejour(): Piece {
  const p = pieceRectangle('Séjour', 400, 300);
  p.ouvertures = [
    { ...nouvelleOuverture('porte', 0, 50), id: 'porte' }, // centre à 91,5
    { ...nouvelleOuverture('fenetre', 0, 250), id: 'fenetre' }, // centre à 300
    { ...nouvelleOuverture('fenetre', 2, 100), id: 'bas' },
  ];
  return p;
}

const ouv = (p: Piece, id: string) => p.ouvertures.find((o) => o.id === id)!;

describe('insérer un sommet', () => {
  it('coupe le côté au milieu et réindexe les ouvertures', () => {
    const p = insererSommet(sejour(), 0);
    expect(p.sommets).toHaveLength(5);
    expect(p.sommets[1]).toMatchObject({ x: 200, y: 0 });
    expect(ouv(p, 'porte')).toMatchObject({ cote: 0, position: 50 });
    // La fenêtre (centre à 300) passe sur la seconde moitié, à 250 − 200 = 50.
    expect(ouv(p, 'fenetre')).toMatchObject({ cote: 1, position: 50 });
    expect(ouv(p, 'bas')).toMatchObject({ cote: 3, position: 100 });
    expect(aire(p.sommets)).toBe(120000);
  });

  it('reprend le type de mur du côté coupé', () => {
    const base = sejour();
    base.sommets[0].typeMurId = null;
    expect(insererSommet(base, 0).sommets[1].typeMurId).toBeNull();
    expect('typeMurId' in insererSommet(sejour(), 0).sommets[1]).toBe(false);
  });

  it('garde sur la première moitié une ouverture qui chevauche la coupe, recalée', () => {
    const base = sejour();
    base.ouvertures = [{ ...nouvelleOuverture('porte', 0, 150), id: 'p' }]; // centre 191,5
    const p = insererSommet(base, 0);
    expect(ouv(p, 'p')).toMatchObject({ cote: 0, position: 200 - 83 });
  });

  it('coupe le dernier côté (retour au premier sommet)', () => {
    const base = sejour();
    base.ouvertures = [{ ...nouvelleOuverture('fenetre', 3, 200), id: 'f' }];
    const p = insererSommet(base, 3, { x: -20, y: 150 });
    expect(p.sommets).toHaveLength(5);
    expect(p.sommets[4]).toMatchObject({ x: 0, y: 150 });
    expect(ouv(p, 'f')).toMatchObject({ cote: 4, position: 50 });
  });

  it('refuse une coupe collée à un sommet', () => {
    const base = sejour();
    expect(insererSommet(base, 0, { x: 0.5, y: 0 })).toBe(base);
  });
});

describe('supprimer un sommet', () => {
  it('fusionne les deux côtés et reporte les ouvertures à leur place', () => {
    const coupe = insererSommet(sejour(), 0);
    const p = supprimerSommet(coupe, 1);
    expect(p.sommets).toHaveLength(4);
    expect(ouv(p, 'porte')).toMatchObject({ cote: 0, position: 50 });
    expect(ouv(p, 'fenetre')).toMatchObject({ cote: 0, position: 250 });
    expect(ouv(p, 'bas')).toMatchObject({ cote: 2, position: 100 });
  });

  it('réindexe correctement quand on retire le premier sommet', () => {
    const base = nouvellePiece('L', [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ]);
    base.sommets[4].typeMurId = 'mur-beton-18';
    base.ouvertures = [
      { ...nouvelleOuverture('porte', 0, 100), id: 'haut' },
      { ...nouvelleOuverture('fenetre', 2, 50), id: 'bas' },
      { ...nouvelleOuverture('fenetre', 4, 100), id: 'gauche' },
    ];
    const p = supprimerSommet(base, 0);
    expect(p.sommets).toHaveLength(4);
    // Le côté fusionné (0,300) → (400,0) est le dernier ; il garde le mur du côté précédent.
    expect(p.sommets[3]).toMatchObject({ x: 0, y: 300, typeMurId: 'mur-beton-18' });
    expect(ouv(p, 'bas')).toMatchObject({ cote: 1, position: 50 });
    expect(ouv(p, 'haut').cote).toBe(3);
    expect(ouv(p, 'gauche').cote).toBe(3);
  });

  it('supprime une ouverture qui ne tient plus sur le côté fusionné', () => {
    const base = nouvellePiece('Pan coupé', [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 100, y: 400 },
      { x: 0, y: 200 },
    ]);
    base.ouvertures = [{ ...nouvelleOuverture('baie', 3, 5, { largeur: 210 }), id: 'baie' }];
    const p = supprimerSommet(base, 3);
    expect(p.ouvertures).toHaveLength(0);
  });

  it('garde au moins 3 sommets', () => {
    const tri = nouvellePiece('T', [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ]);
    expect(supprimerSommet(tri, 1)).toBe(tri);
  });
});

describe('changer la longueur d’un côté', () => {
  it('garde les angles en translatant le côté suivant', () => {
    const p = changerLongueurCote(sejour(), 0, 450);
    expect(p.sommets.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [450, 0],
      [450, 300],
      [0, 300],
    ]);
    expect(longueurCote(p.sommets, 0)).toBe(450);
    expect(aire(p.sommets)).toBe(135000);
    // La fenêtre du bas reste à sa place dans le plan (son côté a commencé 50 cm plus loin).
    expect(ouv(p, 'bas').position).toBe(150);
    expect(ouv(p, 'porte').position).toBe(50);
  });

  it('ne déplace que le sommet de fin sans « garder les angles »', () => {
    const p = changerLongueurCote(sejour(), 0, 450, false);
    expect(p.sommets[1]).toMatchObject({ x: 450, y: 0 });
    expect(p.sommets[2]).toMatchObject({ x: 400, y: 300 });
  });

  it('suit la direction d’un côté oblique et borne les ouvertures', () => {
    const base = nouvellePiece('Biais', [
      { x: 0, y: 0 },
      { x: 300, y: 400 },
      { x: 0, y: 400 },
    ]);
    base.ouvertures = [{ ...nouvelleOuverture('fenetre', 0, 380), id: 'f' }];
    const p = changerLongueurCote(base, 0, 250, false);
    expect(longueurCote(p.sommets, 0)).toBeCloseTo(250, 2);
    expect(p.sommets[1].x).toBeCloseTo(150, 2);
    expect(p.sommets[1].y).toBeCloseTo(200, 2);
    expect(ouv(p, 'f').position).toBeCloseTo(150, 1);
  });

  it('ignore une longueur nulle ou invalide', () => {
    const base = sejour();
    expect(changerLongueurCote(base, 0, 0)).toBe(base);
    expect(changerLongueurCote(base, 0, Number.NaN)).toBe(base);
  });
});

describe('déplacements', () => {
  it('déplace la pièce avec ses équipements, les ouvertures suivent leur côté', () => {
    const base = sejour();
    base.equipements = [nouvelEquipement('baignoire', { x: 100, y: 50 })];
    const p = deplacerPiece(base, 30, -20);
    expect(p.sommets[0]).toMatchObject({ x: 30, y: -20 });
    expect(p.equipements[0]).toMatchObject({ x: 130, y: 30 });
    expect(p.ouvertures).toEqual(base.ouvertures);
    expect(base.sommets[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('déplace un sommet en laissant les ouvertures à leur place', () => {
    const base = sejour();
    const p = deplacerSommet(base, 0, { x: -100, y: 0 });
    expect(p.sommets[0]).toMatchObject({ x: -100, y: 0 });
    // Le côté du haut commence 100 cm plus tôt : la porte reste au même endroit.
    expect(ouv(p, 'porte').position).toBe(150);
    expect(ouv(p, 'bas').position).toBe(100);
  });

  it('orthogonalise en gardant les types de murs', () => {
    const base = nouvellePiece('Relevé', [
      { x: 0, y: 0 },
      { x: 400, y: 6 },
      { x: 397, y: 300 },
      { x: 2, y: 296 },
    ]);
    base.sommets[1].typeMurId = null;
    const p = orthogonaliserPiece(base);
    expect(p.sommets[1].typeMurId).toBeNull();
    const v1 = { x: p.sommets[1].x - p.sommets[0].x, y: p.sommets[1].y - p.sommets[0].y };
    const v2 = { x: p.sommets[2].x - p.sommets[1].x, y: p.sommets[2].y - p.sommets[1].y };
    expect(Math.abs(v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y))).toBeLessThan(1e-3);
  });
});

describe('ajouts', () => {
  it('centre une ouverture sur le point touché, bornée au côté', () => {
    const p = sejour();
    expect(ouvertureSurCote(p, 'porte', 0, 200).position).toBe(Math.round(200 - 41.5));
    expect(ouvertureSurCote(p, 'porte', 0, 10).position).toBe(0);
    expect(ouvertureSurCote(p, 'porte', 0, 395).position).toBe(400 - 83);
    expect(ouvertureSurCote(p, 'fenetre', 1).position).toBe(100);
  });

  it('réduit la largeur d’une ouverture sur un côté trop court', () => {
    const p = pieceRectangle('Placard', 60, 50);
    const o = ouvertureSurCote(p, 'baie', 0);
    expect(o.largeur).toBe(60);
    expect(o.position).toBe(0);
  });

  it('plaque un équipement contre le mur le plus proche, dos au mur', () => {
    const p = sejour();
    const haut = placerEquipement(p, 'baignoire', { x: 200, y: 20 });
    expect(haut).toMatchObject({ x: 200, y: 35, rotation: 0 });
    const droite = placerEquipement(p, 'baignoire', { x: 380, y: 150 });
    expect(droite).toMatchObject({ x: 365, y: 150, rotation: 90 });
    const bas = placerEquipement(p, 'wc', { x: 100, y: 290 });
    expect(bas).toMatchObject({ x: 100, y: 300 - 32.5, rotation: 180 });
    const centre = placerEquipement(p, 'douche', { x: 200, y: 150 });
    expect(centre).toMatchObject({ x: 200, y: 150 });
  });

  it('change le type d’une ouverture en adaptant les dimensions par défaut', () => {
    const porte = nouvelleOuverture('porte', 0, 100); // 83 × 204, centre 141,5
    const fenetre = changerTypeOuverture(porte, 'fenetre', 400);
    expect(fenetre).toMatchObject({ type: 'fenetre', largeur: 100, hauteur: 125, allege: 95, position: 91.5 });
    const surMesure = { ...nouvelleOuverture('fenetre', 0, 0), largeur: 60, allege: 110 };
    expect(changerTypeOuverture(surMesure, 'porte-fenetre', 400)).toMatchObject({ largeur: 60, allege: 0, hauteur: 215 });
    expect(changerTypeOuverture(nouvelleOuverture('passage', 0, 0), 'baie', 150)).toMatchObject({ largeur: 150, position: 0 });
  });

  it('change le type d’un équipement sans perdre les saisies', () => {
    const e = nouvelEquipement('baignoire', { x: 0, y: 0 });
    expect(changerTypeEquipement(e, 'douche')).toMatchObject({ nom: 'Receveur de douche', largeur: 90, profondeur: 90 });
    const renomme = { ...e, nom: 'Baignoire îlot', largeur: 180 };
    expect(changerTypeEquipement(renomme, 'douche')).toMatchObject({ nom: 'Baignoire îlot', largeur: 180, profondeur: 90 });
  });

  it('change un équipement de pièce', () => {
    const a = sejour();
    const b = pieceRectangle('Cuisine', 300, 300);
    const e = nouvelEquipement('evier', { x: 50, y: 50 });
    a.equipements = [e];
    const r = transfererEquipement(a, b, e.id);
    expect(r.source.equipements).toHaveLength(0);
    expect(r.cible.equipements[0].id).toBe(e.id);
  });
});

describe('contrôles', () => {
  it('détecte un contour qui se recoupe', () => {
    expect(seCroise(sejour().sommets)).toBe(false);
    expect(
      seCroise([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ]),
    ).toBe(true);
  });
});
