import { describe, expect, it } from 'vitest';
import { nouveauNiveau, nouveauProjet, pieceRectangle } from '../../model/fabrique';
import {
  apercuPlan,
  detailChantier,
  filtrerChantiers,
  formaterModification,
  formaterOctets,
  normaliser,
  pluriel,
  resumerChantier,
  trierChantiers,
} from './presentation';

/** Espaces insécables du format fr-FR ramenées à des espaces simples. */
const simple = (t: string) => t.replace(/[  ]/g, ' ');

describe('liste des chantiers', () => {
  it('accorde au pluriel à partir de 2', () => {
    expect(pluriel(0, 'pièce')).toBe('0 pièce');
    expect(pluriel(1, 'pièce')).toBe('1 pièce');
    expect(pluriel(2, 'pièce')).toBe('2 pièces');
    expect(pluriel(3, 'niveau', 'niveaux')).toBe('3 niveaux');
  });

  it('écrit la date de modification en français', () => {
    const maintenant = new Date(2026, 9, 10, 15, 0);
    expect(formaterModification(new Date(2026, 9, 10, 9, 5).toISOString(), maintenant)).toBe('Modifié aujourd’hui à 09:05');
    expect(formaterModification(new Date(2026, 9, 9, 23, 59).toISOString(), maintenant)).toBe('Modifié hier à 23:59');
    expect(formaterModification(new Date(2026, 9, 1, 8, 0).toISOString(), maintenant)).toBe('Modifié le 1er octobre');
    expect(formaterModification(new Date(2025, 6, 14, 8, 0).toISOString(), maintenant)).toBe('Modifié le 14 juillet 2025');
    expect(formaterModification('pas une date', maintenant)).toBe('');
  });

  it('résume le chantier : niveaux, pièces et surface du plan actuel', () => {
    const p = nouveauProjet({ nom: 'Villa' });
    expect(detailChantier(resumerChantier(p))).toBe('1 niveau · 0 pièce');
    p.niveaux[0].actuel.pieces.push(pieceRectangle('Salle de bain', 204, 175));
    const etage = nouveauNiveau('R+1', 1);
    etage.actuel.pieces.push(pieceRectangle('Chambre', 400, 300));
    // Le plan rénové ne compte pas dans le résumé.
    etage.renove = { pieces: [pieceRectangle('Grande chambre', 800, 300)] };
    p.niveaux.push(etage);
    const r = resumerChantier(p);
    expect(r).toMatchObject({ niveaux: 2, pieces: 2 });
    expect(r.surface).toBeCloseTo(3.57 + 12, 6);
    expect(simple(detailChantier(r))).toBe('2 niveaux · 2 pièces · 15,57 m²');
  });

  it('cherche sans tenir compte des accents ni de la casse', () => {
    const a = { ...nouveauProjet({ nom: 'Résidence Les Pins', client: 'SCI Hélios', adresse: 'Montpellier' }) };
    const b = { ...nouveauProjet({ nom: 'Villa Dupont', client: 'M. Dupont', adresse: 'Sète' }) };
    expect(normaliser('  ÉlÈve ')).toBe('eleve');
    expect(filtrerChantiers([a, b], 'helios').map((p) => p.nom)).toEqual(['Résidence Les Pins']);
    expect(filtrerChantiers([a, b], 'sete dupont').map((p) => p.nom)).toEqual(['Villa Dupont']);
    expect(filtrerChantiers([a, b], 'villa montpellier')).toEqual([]);
    expect(filtrerChantiers([a, b], '  ')).toHaveLength(2);
  });

  it('trie du plus récent au plus ancien', () => {
    const a = { ...nouveauProjet({ nom: 'A' }), modifieLe: '2026-10-01T10:00:00.000Z' };
    const b = { ...nouveauProjet({ nom: 'B' }), modifieLe: '2026-10-09T10:00:00.000Z' };
    expect(trierChantiers([a, b]).map((p) => p.nom)).toEqual(['B', 'A']);
  });

  it('écrit l’espace utilisé', () => {
    expect(simple(formaterOctets(300))).toBe('1 ko');
    expect(simple(formaterOctets(850 * 1024))).toBe('850 ko');
    expect(simple(formaterOctets(12.44 * 1024 * 1024))).toBe('12,4 Mo');
    expect(simple(formaterOctets(1.25 * 1024 ** 3))).toBe('1,25 Go');
  });

  it('prépare l’aperçu du niveau le plus fourni', () => {
    const p = nouveauProjet({ nom: 'Villa' });
    expect(apercuPlan(p)).toBeNull();
    const sejour = pieceRectangle('Séjour', 500, 400);
    sejour.revetementSolId = 'parquet';
    p.niveaux[0].actuel.pieces.push(sejour, pieceRectangle('Cuisine', 300, 400, { origine: { x: 500, y: 0 } }));
    const a = apercuPlan(p)!;
    expect(a.pieces).toHaveLength(2);
    expect(a.pieces[0].couleur).toBe('#c89f6d');
    expect(a.pieces[1].couleur).toBeNull();
    expect(a.pieces[0].points).toBe('0,0 500,0 500,400 0,400');
    // Marge de 8 % du plus grand côté (800 cm) autour du plan.
    expect(a.viewBox).toBe('-64 -64 928 528');
  });
});
