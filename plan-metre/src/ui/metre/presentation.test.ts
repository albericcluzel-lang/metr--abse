import { describe, expect, it } from 'vitest';
import { arrondir } from '../../metre/calcul';
import { nouveauNiveau, nouveauProjet, nouvelEquipement, nouvelleOuverture, pieceRectangle } from '../../model/fabrique';
import type { Piece, Projet } from '../../model/types';
import {
  blocModifie,
  calculerMetres,
  construireVueMetre,
  ecartNonNul,
  ecartTableur,
  formaterCase,
  formaterEcartPieces,
  formaterPieces,
  NOTE_AUCUNE_PIECE,
  NOTE_NIVEAU_INCHANGE,
  nombreTableur,
  sousTitrePeinture,
  texteTabule,
  varianteCiblePiece,
  type LigneTableau,
  type ModeMetre,
  type OngletMetre,
  type VueMetre,
} from './presentation';

/** Salle de bain de la vidéo de référence : 2,04 × 1,75 m, baignoire et meuble vasque. */
function salleDeBain(): Piece {
  const p = pieceRectangle('Salle de bain', 204, 175, { hauteur: 250, typeMurDefautId: 'cloison-98' });
  p.revetementSolId = 'carrelage';
  const baignoire = nouvelEquipement('baignoire', { x: 93.5, y: 26 });
  baignoire.largeur = 187;
  baignoire.profondeur = 52;
  const vasque = nouvelEquipement('meuble-vasque', { x: 178, y: 110 });
  vasque.largeur = 46;
  vasque.profondeur = 52;
  vasque.rotation = 90;
  p.equipements.push(baignoire, vasque);
  return p;
}

function projetSdb(): Projet {
  const projet = nouveauProjet({ nom: 'Expo', adresse: 'Montpellier' });
  projet.niveaux[0].actuel.pieces.push(salleDeBain());
  return projet;
}

function vue(projet: Projet, mode: ModeMetre, onglet: OngletMetre): VueMetre {
  return construireVueMetre(projet, calculerMetres(projet), mode, onglet);
}

function toutesLignes(v: VueMetre): LigneTableau[] {
  return v.groupes.flatMap((g) => g.blocs.flatMap((b) => b.sections.flatMap((s) => s.lignes)));
}

function ligne(v: VueMetre, cle: string): LigneTableau {
  const l = toutesLignes(v).find((x) => x.cle === cle);
  if (!l) throw new Error(`ligne absente : ${cle}`);
  return l;
}

const arr = (x: number | null) => (x === null ? null : arrondir(x));

describe('vue globale d’un seul plan', () => {
  const v = vue(projetSdb(), 'actuel', 'global');

  it('présente un bloc pour tout le chantier avec sa synthèse', () => {
    expect(v.colonnes).toEqual(['Quantité']);
    expect(v.vide).toBe(false);
    expect(v.groupes).toHaveLength(1);
    const bloc = v.groupes[0].blocs[0];
    expect(bloc.cle).toBe('global');
    expect(bloc.resume.pieces).toEqual([1]);
    expect(bloc.resume.surface.map(arr)).toEqual([3.57]);
  });

  it('range les lignes dans les sections, dans l’ordre de la référence', () => {
    const titres = v.groupes[0].blocs[0].sections.map((s) => s.titre);
    expect(titres).toEqual([
      'Surfaces',
      'Surfaces murs et cloisons',
      'Surfaces à peindre',
      'Volume',
      'Circonférences',
      'Revêtements de sol',
    ]);
    const peinture = v.groupes[0].blocs[0].sections[2];
    expect(peinture.sousTitre).toBe('Hors ouvrants');
    expect(peinture.lignes.map((l) => l.libelle)).toEqual(['Cloison 98 mm', 'Plafond']);
  });

  it('reprend les valeurs de la vidéo', () => {
    expect(arr(ligne(v, 'surfaces:sol').valeurs[0])).toBe(3.57);
    expect(arr(ligne(v, 'murs:cloison-98').valeurs[0])).toBe(18.95);
    expect(arr(ligne(v, 'volume').valeurs[0])).toBe(8.93);
    expect(arr(ligne(v, 'perimetres:interieur').valeurs[0])).toBe(7.58);
    expect(arr(ligne(v, 'perimetres:exterieur').valeurs[0])).toBe(8.36);
    expect(arr(ligne(v, 'sols:carrelage').valeurs[0])).toBe(2.36);
    expect(ligne(v, 'sols:carrelage').libelle).toBe('Carrelage');
  });
});

describe('sous-titre des surfaces à peindre', () => {
  it('suit les réglages de déduction des ouvertures', () => {
    expect(sousTitrePeinture({ deduireOuvertures: true, seuilDeductionOuverture: 0 })).toBe('Hors ouvrants');
    expect(sousTitrePeinture({ deduireOuvertures: true, seuilDeductionOuverture: 0.5 }).replace(/[\u00a0\u202f]/g, ' ')).toBe(
      'Hors ouvrants de plus de 0,50 m²',
    );
    expect(sousTitrePeinture({ deduireOuvertures: false, seuilDeductionOuverture: 0 })).toBe('Ouvertures non déduites');
  });
});

describe('vues par étage et par pièce', () => {
  function projetDeuxNiveaux(): Projet {
    const projet = projetSdb();
    const etage = nouveauNiveau('R+1', 1);
    etage.actuel.pieces.push(pieceRectangle('Chambre', 300, 300));
    const combles = nouveauNiveau('Combles', 2);
    // Ordre volontairement mélangé : l'affichage suit `ordre`.
    projet.niveaux.unshift(combles);
    projet.niveaux.push(etage);
    return projet;
  }

  it('donne un bloc par niveau, dans l’ordre, et signale les niveaux vides', () => {
    const v = vue(projetDeuxNiveaux(), 'actuel', 'etage');
    const blocs = v.groupes[0].blocs;
    expect(blocs.map((b) => b.titre)).toEqual(['RDC', 'R+1', 'Combles']);
    expect(arr(blocs[1].resume.surface[0])).toBe(9);
    expect(blocs[2].sections).toEqual([]);
    expect(blocs[2].note).toBe(NOTE_AUCUNE_PIECE);
    expect(blocs[0].note).toBeUndefined();
  });

  it('regroupe les pièces par niveau', () => {
    const projet = projetDeuxNiveaux();
    const v = vue(projet, 'actuel', 'piece');
    expect(v.groupes.map((g) => g.titre)).toEqual(['RDC', 'R+1', 'Combles']);
    expect(v.groupes[0].blocs.map((b) => b.titre)).toEqual(['Salle de bain']);
    expect(v.groupes[1].blocs[0].pieceId).toBe(projet.niveaux.find((n) => n.nom === 'R+1')!.actuel.pieces[0].id);
    expect(v.groupes[1].blocs[0].varianteCible).toBe('actuel');
    expect(v.groupes[2].blocs).toEqual([]);
    expect(v.groupes[2].note).toBe(NOTE_AUCUNE_PIECE);
  });
});

describe('plan rénové et comparaison', () => {
  /** Rénovation : la salle de bain est agrandie à 2,60 m et reçoit une porte ; un WC est créé ; le R+1 reste inchangé. */
  function projetRenove(): Projet {
    const projet = projetSdb();
    const rdc = projet.niveaux[0];
    rdc.renove = structuredClone(rdc.actuel);
    const sdb = rdc.renove.pieces[0];
    sdb.sommets[1].x = 260;
    sdb.sommets[2].x = 260;
    sdb.ouvertures.push(nouvelleOuverture('porte', 2, 50));
    rdc.renove.pieces.push(pieceRectangle('WC', 100, 150, { origine: { x: 0, y: 300 } }));
    const etage = nouveauNiveau('R+1', 1);
    etage.actuel.pieces.push(pieceRectangle('Chambre', 300, 300));
    projet.niveaux.push(etage);
    return projet;
  }

  it('sans plan rénové, signale que tous les niveaux sont réputés inchangés', () => {
    const projet = projetSdb();
    const v = vue(projet, 'renove', 'global');
    expect(v.aucunPlanRenove).toBe(true);
    expect(v.niveauxInchanges).toEqual(['RDC']);
    expect(arr(ligne(v, 'surfaces:sol').valeurs[0])).toBe(3.57);
    expect(vue(projet, 'actuel', 'global').niveauxInchanges).toEqual([]);
  });

  it('met les deux plans en regard avec l’écart', () => {
    const v = vue(projetRenove(), 'comparer', 'global');
    expect(v.colonnes).toEqual(['Actuel', 'Rénové', 'Écart']);
    expect(v.aucunPlanRenove).toBe(false);
    expect(v.niveauxInchanges).toEqual(['R+1']);
    const sol = ligne(v, 'surfaces:sol');
    expect(sol.valeurs.map(arr)).toEqual([12.57, 15.05]);
    expect(arrondir(sol.ecart!)).toBe(2.48);
    // La porte n'existe que dans le plan rénové : case vide côté actuel.
    const porte = ligne(v, 'ouvertures:porte|83|204');
    expect(porte.valeurs).toEqual([null, 1]);
    expect(porte.ecart).toBe(1);
    expect(v.groupes[0].blocs[0].resume.pieces).toEqual([2, 3]);
  });

  it('suit les pièces par identifiant et repère les nouvelles', () => {
    const projet = projetRenove();
    const v = vue(projet, 'comparer', 'piece');
    const rdc = v.groupes[0];
    expect(rdc.blocs.map((b) => b.titre)).toEqual(['Salle de bain', 'WC']);
    expect(rdc.blocs[0].statut).toBeUndefined();
    expect(rdc.blocs[0].varianteCible).toBe('renove');
    expect(rdc.blocs[1].statut).toBe('nouvelle');
    expect(rdc.blocs[1].resume.surface.map(arr)).toEqual([null, 1.5]);
    const sdbSol = rdc.blocs[0].sections[0].lignes[0];
    expect(arrondir(sdbSol.ecart!)).toBe(0.98);
    // Le R+1 sans plan rénové : écarts nuls, signalé comme inchangé.
    expect(v.groupes[1].note).toBe(NOTE_NIVEAU_INCHANGE);
    expect(v.groupes[1].blocs[0].varianteCible).toBe('actuel');
    expect(v.groupes[1].blocs[0].sections.flatMap((s) => s.lignes).every((l) => l.ecart === 0)).toBe(true);
  });

  it('repère les pièces supprimées par la rénovation', () => {
    const projet = projetRenove();
    projet.niveaux[0].renove!.pieces.shift();
    const v = vue(projet, 'comparer', 'piece');
    const sdb = v.groupes[0].blocs.find((b) => b.titre === 'Salle de bain')!;
    expect(sdb.statut).toBe('supprimee');
    expect(sdb.varianteCible).toBe('actuel');
    expect(sdb.sections[0].lignes[0].valeurs[1]).toBeNull();
    expect(arrondir(sdb.sections[0].lignes[0].ecart!)).toBe(-3.57);
  });

  it('repère une pièce modifiée même à surface égale', () => {
    const projet = projetSdb();
    const rdc = projet.niveaux[0];
    rdc.renove = structuredClone(rdc.actuel);
    const blocs = () => vue(projet, 'comparer', 'piece').groupes[0].blocs;
    expect(blocModifie(blocs()[0])).toBe(false);
    rdc.renove.pieces[0].ouvertures.push(nouvelleOuverture('fenetre', 0, 50));
    const b = blocs()[0];
    expect(arrondir(b.sections[0].lignes[0].ecart!)).toBe(0);
    expect(blocModifie(b)).toBe(true);
    expect(blocModifie(vue(projetRenove(), 'comparer', 'piece').groupes[0].blocs[1])).toBe(true); // nouvelle pièce
  });

  it('montre le plan rénové seul, pièces nouvelles comprises', () => {
    const v = vue(projetRenove(), 'renove', 'piece');
    expect(v.colonnes).toEqual(['Quantité']);
    expect(v.groupes[0].blocs.map((b) => [b.titre, b.varianteCible])).toEqual([
      ['Salle de bain', 'renove'],
      ['WC', 'renove'],
    ]);
  });
});

describe('variante à ouvrir sur le plan', () => {
  it('ne demande jamais le plan rénové d’un niveau qui n’en a pas', () => {
    const projet = projetSdb();
    const n = projet.niveaux[0];
    const id = n.actuel.pieces[0].id;
    expect(varianteCiblePiece(n, id, 'renove')).toBe('actuel');
    expect(varianteCiblePiece(n, id, 'comparer')).toBe('actuel');
    n.renove = structuredClone(n.actuel);
    expect(varianteCiblePiece(n, id, 'renove')).toBe('renove');
    expect(varianteCiblePiece(n, id, 'actuel')).toBe('actuel');
    expect(varianteCiblePiece(n, 'inconnue', 'comparer')).toBe('actuel');
  });
});

describe('chantier vide', () => {
  it('est signalé comme vide', () => {
    const projet = nouveauProjet({ nom: 'Vide' });
    const v = vue(projet, 'actuel', 'global');
    expect(v.vide).toBe(true);
    expect(v.groupes[0].blocs[0].sections).toEqual([]);
    expect(vue(projet, 'comparer', 'etage').vide).toBe(true);
  });
});

describe('formats', () => {
  it('affiche les cases, les écarts et les nombres de pièces', () => {
    expect(formaterCase(null, 'm²')).toBe('—');
    expect(formaterCase(3.5696, 'm²')).toBe('3,57 m²');
    expect(ecartNonNul(0.004, 'm²')).toBe(false);
    expect(ecartNonNul(0.006, 'm²')).toBe(true);
    expect(ecartNonNul(1, 'u')).toBe(true);
    expect(formaterPieces(1)).toBe('1 pièce');
    expect(formaterPieces(0)).toBe('0 pièce');
    expect(formaterPieces(3)).toBe('3 pièces');
    expect(formaterEcartPieces(0)).toBe('=');
    expect(formaterEcartPieces(2)).toBe('+2');
    expect(formaterEcartPieces(-1)).toBe('−1');
  });

  it('écrit des nombres lisibles par un tableur français', () => {
    expect(nombreTableur(1234.5, 'm²')).toBe('1234,50');
    expect(nombreTableur(8.925, 'm³')).toBe('8,93');
    expect(nombreTableur(-0.001, 'm')).toBe('0,00');
    expect(nombreTableur(2, 'u')).toBe('2');
    expect(ecartTableur(1.2, 'm²')).toBe('+1,20');
    expect(ecartTableur(-0.4, 'm')).toBe('-0,40');
    expect(ecartTableur(0.001, 'm')).toBe('0,00');
    expect(ecartTableur(-2, 'u')).toBe('-2');
  });
});

describe('texte pour le presse-papiers', () => {
  const entete = { nom: 'Expo', client: 'ABSE', adresse: 'Montpellier', date: '10 octobre 2026' };

  it('donne une ligne tabulée par quantité, sous les titres de section', () => {
    const t = texteTabule(vue(projetSdb(), 'actuel', 'global'), entete);
    const lignes = t.split('\n');
    expect(lignes.slice(0, 4)).toEqual(['Métré — Expo', 'Client : ABSE', 'Adresse : Montpellier', 'Plan actuel — Global — 10 octobre 2026']);
    expect(lignes).toContain('Désignation\tQuantité\tUnité');
    expect(lignes).toContain('Nombre de pièces\t1\t');
    expect(lignes).toContain('Surface totale\t3,57\tm²');
    expect(lignes).toContain('SURFACES À PEINDRE (HORS OUVRANTS)');
    expect(lignes).toContain('Cloison 98 mm\t18,95\tm²');
    expect(lignes).toContain('Volume\t8,93\tm³');
    expect(lignes).toContain('Extérieure\t8,36\tm');
    expect(lignes).toContain('Carrelage\t2,36\tm²');
    // Rien qui empêcherait le tableur de lire les nombres.
    expect(t).not.toMatch(/[\u00a0\u202f\u2212]/);
  });

  it('ajoute les colonnes Actuel, Rénové et Écart en comparaison', () => {
    const projet = projetSdb();
    const rdc = projet.niveaux[0];
    rdc.renove = structuredClone(rdc.actuel);
    rdc.renove.pieces[0].sommets[1].x = 260;
    rdc.renove.pieces[0].sommets[2].x = 260;
    rdc.renove.pieces[0].ouvertures.push(nouvelleOuverture('porte', 2, 50));
    const lignes = texteTabule(vue(projet, 'comparer', 'piece'), entete).split('\n');
    expect(lignes).toContain('Désignation\tActuel\tRénové\tÉcart\tUnité');
    expect(lignes).toContain('RDC');
    expect(lignes).toContain('Surface au sol\t3,57\t4,55\t+0,98\tm²');
    expect(lignes).toContain('Porte (83 × 204 cm)\t\t1\t+1\tu');
  });

  it('neutralise tabulations et retours à la ligne des noms saisis', () => {
    const projet = projetSdb();
    projet.niveaux[0].actuel.pieces[0].nom = 'Salle\tde\nbain';
    const t = texteTabule(vue(projet, 'actuel', 'piece'), { nom: 'A\tB', date: 'aujourd’hui' });
    expect(t.split('\n')).toContain('Salle de bain');
    expect(t.startsWith('Métré — A B\n')).toBe(true);
  });

  it('signale les niveaux sans plan rénové', () => {
    const t = texteTabule(vue(projetSdb(), 'renove', 'etage'), entete);
    expect(t).toContain('Sans plan rénové (réputé inchangé) : RDC');
    expect(t).toContain(NOTE_NIVEAU_INCHANGE);
  });
});
