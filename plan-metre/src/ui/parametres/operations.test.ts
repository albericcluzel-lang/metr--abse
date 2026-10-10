import { describe, expect, it } from 'vitest';
import { nouveauNiveau, nouveauProjet, pieceRectangle } from '../../model/fabrique';
import {
  ajouterNiveau,
  deplacerNiveau,
  niveauxTries,
  nouveauRevetement,
  nouveauTypeMur,
  supprimerNiveau,
  supprimerRevetement,
  supprimerTypeMur,
  typeMurRemplacement,
  usageRevetement,
  usageTypeMur,
} from './operations';

const noms = (p: ReturnType<typeof nouveauProjet>) => niveauxTries(p).map((n) => `${n.ordre}:${n.nom}`);

describe('niveaux', () => {
  it('ajoute au-dessus, et le sous-sol en dessous', () => {
    const p = nouveauProjet({ nom: 'Villa' });
    ajouterNiveau(p, nouveauNiveau('R+1', 0));
    ajouterNiveau(p, nouveauNiveau('Sous-sol', 0));
    ajouterNiveau(p, nouveauNiveau('Combles', 0));
    expect(noms(p)).toEqual(['0:Sous-sol', '1:RDC', '2:R+1', '3:Combles']);
  });

  it('monte et descend un niveau, sans dépasser les bouts', () => {
    const p = nouveauProjet({ nom: 'Villa' });
    ajouterNiveau(p, nouveauNiveau('R+1', 0));
    ajouterNiveau(p, nouveauNiveau('R+2', 0));
    const r1 = p.niveaux.find((n) => n.nom === 'R+1')!;
    expect(deplacerNiveau(p, r1.id, 1)).toBe(true);
    expect(noms(p)).toEqual(['0:RDC', '1:R+2', '2:R+1']);
    expect(deplacerNiveau(p, r1.id, 1)).toBe(false);
    expect(deplacerNiveau(p, r1.id, -1)).toBe(true);
    expect(deplacerNiveau(p, r1.id, -1)).toBe(true);
    expect(noms(p)).toEqual(['0:R+1', '1:RDC', '2:R+2']);
    expect(deplacerNiveau(p, r1.id, -1)).toBe(false);
  });

  it('renumérote des ordres irréguliers', () => {
    const p = nouveauProjet({ nom: 'Villa' });
    p.niveaux[0].ordre = 4;
    const haut = nouveauNiveau('R+1', 9);
    p.niveaux.push(haut);
    deplacerNiveau(p, haut.id, -1);
    expect(noms(p)).toEqual(['0:R+1', '1:RDC']);
  });

  it('supprime un niveau mais jamais le dernier', () => {
    const p = nouveauProjet({ nom: 'Villa' });
    const rdc = p.niveaux[0];
    expect(supprimerNiveau(p, rdc.id)).toBe(false);
    ajouterNiveau(p, nouveauNiveau('Sous-sol', 0));
    ajouterNiveau(p, nouveauNiveau('R+1', 0));
    const ss = p.niveaux.find((n) => n.nom === 'Sous-sol')!;
    expect(supprimerNiveau(p, ss.id)).toBe(true);
    expect(noms(p)).toEqual(['0:RDC', '1:R+1']);
    expect(supprimerNiveau(p, 'inconnu')).toBe(false);
  });
});

describe('catalogue', () => {
  it('réaffecte les pièces et les côtés d’un type de mur supprimé', () => {
    const p = nouveauProjet({ nom: 'Villa' });
    const a = pieceRectangle('Séjour', 500, 400, { typeMurDefautId: 'mur-parpaing-20' });
    a.sommets[1].typeMurId = 'cloison-72';
    a.sommets[2].typeMurId = null; // pas de mur : inchangé
    const b = pieceRectangle('Chambre', 300, 300, { typeMurDefautId: 'cloison-72' });
    b.sommets[0].typeMurId = 'cloison-72';
    p.niveaux[0].actuel.pieces.push(a, b);
    p.niveaux[0].renove = { pieces: [pieceRectangle('Bureau', 300, 300, { typeMurDefautId: 'cloison-72' })] };

    expect(usageTypeMur(p, 'cloison-72')).toBe(3);
    expect(usageTypeMur(p, 'mur-pierre-40')).toBe(0);
    expect(typeMurRemplacement(p.catalogue, 'cloison-72')!.id).toBe('cloison-98');

    expect(supprimerTypeMur(p, 'cloison-72')).toBe(true);
    expect(p.catalogue.typesMurs.some((t) => t.id === 'cloison-72')).toBe(false);
    expect(a.typeMurDefautId).toBe('mur-parpaing-20');
    expect(a.sommets[1].typeMurId).toBe('cloison-98');
    expect(a.sommets[2].typeMurId).toBeNull();
    expect(b.typeMurDefautId).toBe('cloison-98');
    expect('typeMurId' in b.sommets[0]).toBe(false);
    expect(p.niveaux[0].renove!.pieces[0].typeMurDefautId).toBe('cloison-98');
    expect(usageTypeMur(p, 'cloison-72')).toBe(0);
  });

  it('se rabat sur le premier type restant et garde au moins un type', () => {
    const p = nouveauProjet({ nom: 'Villa' });
    p.catalogue.typesMurs = p.catalogue.typesMurs.filter((t) => ['cloison-98', 'mur-beton-18'].includes(t.id));
    expect(typeMurRemplacement(p.catalogue, 'cloison-98')!.id).toBe('mur-beton-18');
    expect(supprimerTypeMur(p, 'cloison-98')).toBe(true);
    expect(supprimerTypeMur(p, 'mur-beton-18')).toBe(false);
    expect(p.catalogue.typesMurs).toHaveLength(1);
  });

  it('passe en « non renseigné » les pièces d’un revêtement supprimé', () => {
    const p = nouveauProjet({ nom: 'Villa' });
    const a = pieceRectangle('Séjour', 500, 400);
    a.revetementSolId = 'parquet';
    const b = pieceRectangle('Cuisine', 300, 300);
    b.revetementSolId = 'carrelage';
    p.niveaux[0].actuel.pieces.push(a, b);
    // La même pièce recopiée dans le plan rénové ne compte qu'une fois.
    p.niveaux[0].renove = structuredClone(p.niveaux[0].actuel);
    expect(usageRevetement(p, 'parquet')).toBe(1);
    expect(supprimerRevetement(p, 'parquet')).toBe(true);
    expect(a.revetementSolId).toBeNull();
    expect(p.niveaux[0].renove.pieces[0].revetementSolId).toBeNull();
    expect(b.revetementSolId).toBe('carrelage');
    expect(supprimerRevetement(p, 'parquet')).toBe(false);
  });

  it('propose des noms et couleurs libres', () => {
    const p = nouveauProjet({ nom: 'Villa' });
    const t1 = nouveauTypeMur(p.catalogue);
    p.catalogue.typesMurs.push(t1);
    expect(t1.nom).toBe('Nouveau type de mur');
    expect(nouveauTypeMur(p.catalogue).nom).toBe('Nouveau type de mur 2');
    const r1 = nouveauRevetement(p.catalogue);
    p.catalogue.revetementsSol.push(r1);
    const r2 = nouveauRevetement(p.catalogue);
    expect(r2.nom).toBe('Nouveau revêtement 2');
    expect(r2.couleur).not.toBe(r1.couleur);
    expect(r1.couleur).toMatch(/^#[0-9a-f]{6}$/);
  });
});
