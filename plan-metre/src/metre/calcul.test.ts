import { describe, expect, it } from 'vitest';
import { catalogueParDefaut, parametresParDefaut } from '../model/catalogue';
import { nouveauProjet, nouvelEquipement, nouvelleOuverture, pieceRectangle } from '../model/fabrique';
import type { Plan } from '../model/types';
import {
  arrondir,
  comparerLignes,
  formaterEcart,
  formaterValeur,
  lignesMetre,
  metrePiece,
  metreProjet,
} from './calcul';

const catalogue = catalogueParDefaut();
const parametres = parametresParDefaut();

function valeur(lignes: ReturnType<typeof lignesMetre>, cle: string): number {
  const l = lignes.find((x) => x.cle === cle);
  if (!l) throw new Error(`ligne absente : ${cle}`);
  return arrondir(l.valeur, 2);
}

describe('métré d’une pièce — exemple de la vidéo (salle de bain)', () => {
  // Pièce de 2,04 × 1,75 m, hauteur 2,50 m, cloisons de 98 mm.
  const sdb = pieceRectangle('Salle de bain', 204, 175, { hauteur: 250, typeMurDefautId: 'cloison-98' });
  const lignes = lignesMetre(metrePiece(sdb, catalogue, parametres), catalogue);

  it('reproduit les valeurs affichées par l’appli de référence', () => {
    expect(valeur(lignes, 'surfaces:sol')).toBe(3.57);
    expect(valeur(lignes, 'murs:cloison-98')).toBe(18.95);
    expect(valeur(lignes, 'peinture:cloison-98')).toBe(18.95);
    expect(valeur(lignes, 'peinture:plafond')).toBe(3.57);
    expect(valeur(lignes, 'volume')).toBe(8.93);
    expect(valeur(lignes, 'perimetres:interieur')).toBe(7.58);
    expect(valeur(lignes, 'perimetres:plinthes')).toBe(7.58);
    // 7,58 m + 8 × 0,098 m (rectangle décalé de l'épaisseur de cloison).
    expect(valeur(lignes, 'perimetres:exterieur')).toBe(8.36);
  });

  it('déduit l’emprise de la baignoire et du meuble vasque du revêtement de sol', () => {
    const p = structuredClone(sdb);
    p.revetementSolId = 'carrelage';
    const baignoire = nouvelEquipement('baignoire', { x: 93.5, y: 26 });
    baignoire.largeur = 187;
    baignoire.profondeur = 52;
    const vasque = nouvelEquipement('meuble-vasque', { x: 204 - 26, y: 110 });
    vasque.largeur = 46;
    vasque.profondeur = 52;
    vasque.rotation = 90;
    p.equipements.push(baignoire, vasque);
    const l = lignesMetre(metrePiece(p, catalogue, parametres), catalogue);
    // 35700 − 187 × 52 − 52 × 46 = 23584 cm²
    expect(valeur(l, 'sols:carrelage')).toBe(2.36);
  });

  it('ne compte que la partie de l’équipement à l’intérieur de la pièce', () => {
    const p = structuredClone(sdb);
    const e = nouvelEquipement('baignoire', { x: 0, y: 50 }); // à cheval sur le mur gauche
    e.largeur = 100;
    e.profondeur = 50;
    p.equipements.push(e);
    const l = lignesMetre(metrePiece(p, catalogue, parametres), catalogue);
    expect(valeur(l, 'sols:')).toBe(arrondir((35700 - 50 * 50) / 1e4));
  });
});

describe('ouvertures', () => {
  it('déduit portes et fenêtres des surfaces à peindre et la porte des plinthes', () => {
    const p = pieceRectangle('Chambre', 400, 300, { hauteur: 250 });
    p.ouvertures.push(nouvelleOuverture('porte', 2, 50)); // 83 × 204, au sol
    p.ouvertures.push(nouvelleOuverture('fenetre', 0, 150)); // 100 × 125, allège 95
    const l = lignesMetre(metrePiece(p, catalogue, parametres), catalogue);
    expect(valeur(l, 'murs:cloison-98')).toBe(35);
    expect(valeur(l, 'peinture:cloison-98')).toBe(arrondir(35 - 0.83 * 2.04 - 1 * 1.25));
    expect(valeur(l, 'perimetres:plinthes')).toBe(arrondir(14 - 0.83));
    expect(l.find((x) => x.cle === 'ouvertures:porte|83|204')?.valeur).toBe(1);
    expect(l.find((x) => x.cle === 'ouvertures:fenetre|100|125')?.valeur).toBe(1);
  });

  it('respecte le réglage « ne pas déduire » et le seuil de déduction', () => {
    const p = pieceRectangle('Chambre', 400, 300, { hauteur: 250 });
    p.ouvertures.push(nouvelleOuverture('porte', 2, 50));
    p.ouvertures.push(nouvelleOuverture('fenetre', 0, 150, { largeur: 60, hauteur: 60 })); // 0,36 m²
    const sansDeduction = lignesMetre(metrePiece(p, catalogue, { deduireOuvertures: false, seuilDeductionOuverture: 0 }), catalogue);
    expect(valeur(sansDeduction, 'peinture:cloison-98')).toBe(35);
    const seuil = lignesMetre(metrePiece(p, catalogue, { deduireOuvertures: true, seuilDeductionOuverture: 0.5 }), catalogue);
    expect(valeur(seuil, 'peinture:cloison-98')).toBe(arrondir(35 - 0.83 * 2.04));
  });

  it('borne l’ouverture au côté et à la hauteur sous plafond', () => {
    const p = pieceRectangle('Débarras', 100, 100, { hauteur: 200 });
    p.ouvertures.push(nouvelleOuverture('porte', 0, 60, { largeur: 83, hauteur: 204 }));
    const l = lignesMetre(metrePiece(p, catalogue, parametres), catalogue);
    // largeur utile 40 cm, hauteur utile 200 cm
    expect(valeur(l, 'peinture:cloison-98')).toBe(arrondir(8 - 0.4 * 2));
    expect(valeur(l, 'perimetres:plinthes')).toBe(arrondir(4 - 0.4));
  });

  it('déduit la porte aussi dans la pièce voisine, sans la compter deux fois', () => {
    const projet = nouveauProjet({ nom: 'Test' });
    const chambre = pieceRectangle('Chambre', 300, 300, { hauteur: 250 });
    // Couloir collé à droite de la chambre, de l'autre côté de la cloison de 9,8 cm.
    const couloir = pieceRectangle('Couloir', 120, 300, { hauteur: 250, origine: { x: 309.8, y: 0 } });
    chambre.ouvertures.push(nouvelleOuverture('porte', 1, 100)); // côté droit de la chambre
    const plan: Plan = { pieces: [chambre, couloir] };
    projet.niveaux[0].actuel = plan;
    const m = metreProjet(projet, 'actuel');
    const couloirLignes = lignesMetre(m.parPiece[1].detail, projet.catalogue);
    expect(valeur(couloirLignes, 'peinture:cloison-98')).toBe(arrondir(8.4 * 2.5 - 0.83 * 2.04));
    expect(valeur(couloirLignes, 'perimetres:plinthes')).toBe(arrondir(8.4 - 0.83));
    const global = lignesMetre(m.global, projet.catalogue);
    expect(global.find((x) => x.cle === 'ouvertures:porte|83|204')?.valeur).toBe(1);
  });

  it('ne déduit pas deux fois une porte saisie dans les deux pièces', () => {
    const chambre = pieceRectangle('Chambre', 300, 300);
    const couloir = pieceRectangle('Couloir', 120, 300, { origine: { x: 309.8, y: 0 } });
    chambre.ouvertures.push(nouvelleOuverture('porte', 1, 100));
    // Côté gauche du couloir (sommet 3 → 0), parcouru de bas en haut : position 300 − 100 − 83.
    couloir.ouvertures.push(nouvelleOuverture('porte', 3, 117));
    const plan: Plan = { pieces: [chambre, couloir] };
    const l = lignesMetre(metrePiece(couloir, catalogue, parametres, plan), catalogue);
    expect(valeur(l, 'peinture:cloison-98')).toBe(arrondir(8.4 * 2.5 - 0.83 * 2.04));
  });
});

describe('murs particuliers', () => {
  it('ignore les côtés sans mur (séparation fictive)', () => {
    const p = pieceRectangle('Cuisine ouverte', 300, 200, { hauteur: 250 });
    p.sommets[1].typeMurId = null; // côté droit ouvert
    const l = lignesMetre(metrePiece(p, catalogue, parametres), catalogue);
    expect(valeur(l, 'murs:cloison-98')).toBe(arrondir((300 + 300 + 200) * 250 / 1e4));
    expect(valeur(l, 'perimetres:interieur')).toBe(10);
    expect(valeur(l, 'perimetres:plinthes')).toBe(8);
    // Pas d'épaisseur ajoutée côté ouvert : 10 + 2 × 0,098 × 2 + 2 × 0,098
    expect(valeur(l, 'perimetres:exterieur')).toBe(arrondir(10 + 3 * 2 * 0.098));
  });

  it('regroupe les surfaces par type de mur', () => {
    const p = pieceRectangle('Séjour', 500, 400, { hauteur: 250 });
    p.sommets[0].typeMurId = 'mur-parpaing-20';
    const l = lignesMetre(metrePiece(p, catalogue, parametres), catalogue);
    expect(valeur(l, 'murs:mur-parpaing-20')).toBe(12.5);
    expect(valeur(l, 'murs:cloison-98')).toBe(arrondir((400 + 500 + 400) * 2.5 / 100));
  });

  it('calcule une pièce en L', () => {
    const p = pieceRectangle('L', 400, 400);
    p.sommets = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 400 },
      { x: 0, y: 400 },
    ];
    const l = lignesMetre(metrePiece(p, catalogue, parametres), catalogue);
    expect(valeur(l, 'surfaces:sol')).toBe(12);
    expect(valeur(l, 'perimetres:interieur')).toBe(16);
    // Décalage de e : +2e par angle saillant (5), −2e par angle rentrant (1).
    expect(valeur(l, 'perimetres:exterieur')).toBe(arrondir(16 + 8 * 0.098));
  });

  it('donne le même résultat quel que soit le sens de parcours du contour', () => {
    const p = pieceRectangle('Chambre', 400, 300);
    const q = structuredClone(p);
    q.sommets.reverse();
    const a = lignesMetre(metrePiece(p, catalogue, parametres), catalogue);
    const b = lignesMetre(metrePiece(q, catalogue, parametres), catalogue);
    expect(valeur(b, 'perimetres:exterieur')).toBe(valeur(a, 'perimetres:exterieur'));
    expect(valeur(b, 'surfaces:sol')).toBe(valeur(a, 'surfaces:sol'));
  });
});

describe('projet multi-niveaux et plan rénové', () => {
  it('additionne les niveaux et compare actuel / rénové', () => {
    const projet = nouveauProjet({ nom: 'Maison' });
    projet.niveaux[0].actuel.pieces.push(pieceRectangle('Séjour', 500, 400));
    projet.niveaux.push({
      id: 'etage',
      nom: 'R+1',
      ordre: 1,
      hauteurDefaut: 250,
      actuel: { pieces: [pieceRectangle('Chambre', 300, 300)] },
      renove: null,
    });
    // Rénovation du RDC : le séjour est recoupé.
    projet.niveaux[0].renove = { pieces: [pieceRectangle('Séjour', 300, 400), pieceRectangle('Bureau', 190.2, 400, { origine: { x: 309.8, y: 0 } })] };

    const actuel = metreProjet(projet, 'actuel');
    const renove = metreProjet(projet, 'renove');
    expect(arrondir(actuel.global.surfaceSol / 1e4)).toBe(29);
    expect(actuel.parNiveau.map((n) => n.niveauNom)).toEqual(['RDC', 'R+1']);
    // Le R+1 sans plan rénové est réputé inchangé.
    expect(renove.parNiveau[1].detail.surfaceSol).toBe(actuel.parNiveau[1].detail.surfaceSol);
    const comp = comparerLignes(lignesMetre(actuel.global, projet.catalogue), lignesMetre(renove.global, projet.catalogue));
    const sol = comp.find((c) => c.cle === 'surfaces:sol')!;
    expect(arrondir(sol.ecart)).toBe(arrondir((300 * 400 + 190.2 * 400 - 500 * 400) / 1e4));
    expect(comp.findIndex((c) => c.section === 'murs')).toBeGreaterThan(comp.findIndex((c) => c.section === 'surfaces'));
  });
});

describe('formatage', () => {
  it('arrondit sans erreur de virgule flottante', () => {
    expect(arrondir(8.925)).toBe(8.93);
    expect(arrondir(1.005)).toBe(1.01);
    expect(arrondir(-1.005)).toBe(-1.01);
    expect(arrondir(2.675)).toBe(2.68);
  });

  it('formate à la française', () => {
    expect(formaterValeur(3.5696, 'm²').replace(/ | /g, ' ')).toBe('3,57 m²');
    expect(formaterValeur(1234.5, 'm').replace(/ | /g, ' ')).toBe('1 234,50 m');
    expect(formaterValeur(2, 'u')).toBe('2 u');
    expect(formaterEcart(0.001, 'm²')).toBe('=');
    expect(formaterEcart(-0.4, 'm').replace(/ | /g, ' ')).toBe('−0,40 m');
  });
});
