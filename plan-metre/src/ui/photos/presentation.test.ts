import { describe, expect, it } from 'vitest';
import { nouveauNiveau, nouveauProjet, pieceRectangle } from '../../model/fabrique';
import type { Photo } from '../../model/types';
import {
  formaterDatePhoto,
  libellePhoto,
  nomFichierPhoto,
  ordreAffichage,
  piecesDuNiveau,
  regrouperPhotos,
  texteProgression,
} from './presentation';

function photo(id: string, niveauId: string | null, pieceId: string | null, date: string, legende = ''): Photo {
  return { id, projetId: 'p', niveauId, pieceId, position: null, legende, date, largeur: 10, hauteur: 10 };
}

function chantier() {
  const p = nouveauProjet({ nom: 'Villa' });
  const rdc = p.niveaux[0];
  const sejour = pieceRectangle('Séjour', 500, 400);
  const cuisine = pieceRectangle('Cuisine', 300, 400);
  rdc.actuel.pieces.push(sejour, cuisine);
  // Le plan rénové réunit les deux pièces et ajoute une véranda.
  const veranda = pieceRectangle('Véranda', 300, 200);
  rdc.renove = { pieces: [{ ...sejour, nom: 'Séjour-cuisine' }, veranda] };
  const etage = nouveauNiveau('R+1', 1);
  const chambre = pieceRectangle('Chambre', 400, 300);
  etage.actuel.pieces.push(chambre);
  const sousSol = nouveauNiveau('Sous-sol', -1);
  p.niveaux.push(etage, sousSol);
  return { p, rdc, etage, sousSol, sejour, cuisine, veranda, chambre };
}

describe('regroupement des photos', () => {
  it('liste les pièces du plan affiché puis celles de l’autre plan', () => {
    const { rdc } = chantier();
    expect(piecesDuNiveau(rdc, 'actuel').map((x) => x.nom)).toEqual(['Séjour', 'Cuisine', 'Véranda']);
    expect(piecesDuNiveau(rdc, 'renove').map((x) => x.nom)).toEqual(['Séjour-cuisine', 'Véranda', 'Cuisine']);
  });

  it('groupe par niveau, puis par pièce, puis « Sans pièce », et enfin « Sans niveau »', () => {
    const { p, rdc, etage, sejour, cuisine, chambre } = chantier();
    const photos = [
      photo('a', rdc.id, cuisine.id, '2026-10-10T09:00:00Z'),
      photo('b', rdc.id, sejour.id, '2026-10-10T10:00:00Z'),
      photo('c', rdc.id, sejour.id, '2026-10-10T08:00:00Z'),
      photo('d', rdc.id, null, '2026-10-10T08:30:00Z'),
      photo('e', rdc.id, 'piece-supprimee', '2026-10-10T07:00:00Z'),
      photo('f', etage.id, chambre.id, '2026-10-10T11:00:00Z'),
      photo('g', null, null, '2026-10-09T11:00:00Z'),
      photo('h', 'niveau-supprime', null, '2026-10-10T12:00:00Z'),
    ];
    const groupes = regrouperPhotos(photos, p, 'actuel');
    // Le sous-sol (sans photo) n'apparaît pas ; l'ordre suit les niveaux.
    expect(groupes.map((g) => [g.titre, g.nombre])).toEqual([
      ['RDC', 5],
      ['R+1', 1],
      ['Sans niveau', 2],
    ]);
    expect(groupes[0].pieces.map((s) => [s.titre, s.photos.map((x) => x.id)])).toEqual([
      ['Séjour', ['c', 'b']],
      ['Cuisine', ['a']],
      ['Sans pièce', ['e', 'd']],
    ]);
    expect(groupes[2].pieces).toHaveLength(1);
    expect(groupes[2].pieces[0].titre).toBeNull();
    expect(ordreAffichage(groupes).map((x) => x.id)).toEqual(['c', 'b', 'a', 'e', 'd', 'f', 'g', 'h']);
  });

  it('prend les noms du plan affiché (plan rénové)', () => {
    const { p, rdc, sejour, cuisine, veranda } = chantier();
    const photos = [
      photo('a', rdc.id, cuisine.id, '2026-10-10T09:00:00Z'),
      photo('b', rdc.id, sejour.id, '2026-10-10T10:00:00Z'),
      photo('c', rdc.id, veranda.id, '2026-10-10T10:00:00Z'),
    ];
    const g = regrouperPhotos(photos, p, 'renove')[0];
    expect(g.pieces.map((s) => s.titre)).toEqual(['Séjour-cuisine', 'Véranda', 'Cuisine']);
  });

  it('rend un tableau vide sans photo', () => {
    expect(regrouperPhotos([], chantier().p, 'actuel')).toEqual([]);
  });
});

describe('libellés des photos', () => {
  it('écrit la date en français', () => {
    expect(formaterDatePhoto(new Date(2026, 9, 1, 9, 5).toISOString())).toBe('1er octobre 2026 à 09:05');
    expect(formaterDatePhoto(new Date(2026, 6, 14, 18, 30).toISOString())).toBe('14 juillet 2026 à 18:30');
    expect(formaterDatePhoto('n’importe quoi')).toBe('');
  });

  it('nomme la vignette pour les lecteurs d’écran', () => {
    const d = new Date(2026, 9, 10, 9, 5).toISOString();
    expect(libellePhoto(photo('a', null, null, d, ' Fissure '))).toBe('Fissure (photo du 10 octobre 2026 à 09:05)');
    expect(libellePhoto(photo('a', null, null, d))).toBe('Photo du 10 octobre 2026 à 09:05');
  });

  it('nomme le fichier partagé', () => {
    const d = new Date(2026, 9, 10, 9, 5).toISOString();
    expect(nomFichierPhoto('Villa Dupont', photo('a', null, null, d, 'Fissure au plafond !'))).toBe(
      'villa-dupont-fissure-au-plafond-2026-10-10.jpg',
    );
    expect(nomFichierPhoto('Villa Dupont', photo('a', null, null, d))).toBe('villa-dupont-2026-10-10.jpg');
  });

  it('indique la progression', () => {
    expect(texteProgression(0, 1)).toBe('Préparation de la photo…');
    expect(texteProgression(1, 5)).toBe('Préparation 2/5…');
    expect(texteProgression(5, 5)).toBe('Préparation 5/5…');
  });
});
