import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { pieceRectangle } from '../model/fabrique';
import { lireSecours, planCourant, sauverEnSecours, useEtat } from './etat';
import * as persistance from './persistance';

async function reinitialiser() {
  const { projets } = useEtat.getState();
  for (const p of projets) await persistance.supprimerProjet(p.id);
  useEtat.setState({ projets: [], projet: null, passe: [], futur: [], photos: [], selection: null, variante: 'actuel' });
}

describe('état de l’appli', () => {
  beforeEach(reinitialiser);

  it('crée, modifie, annule et rétablit', async () => {
    const e = useEtat.getState();
    const p = await e.creerProjet({ nom: 'Villa Montpellier' });
    expect(await useEtat.getState().ouvrirProjet(p.id)).toBe(true);
    useEtat.getState().modifierPlan((plan) => plan.pieces.push(pieceRectangle('Séjour', 500, 400)));
    expect(planCourant(useEtat.getState())!.pieces).toHaveLength(1);
    useEtat.getState().annuler();
    expect(planCourant(useEtat.getState())!.pieces).toHaveLength(0);
    useEtat.getState().retablir();
    expect(planCourant(useEtat.getState())!.pieces).toHaveLength(1);
  });

  it('regroupe un glisser en une seule étape d’annulation', async () => {
    const p = await useEtat.getState().creerProjet({ nom: 'Test' });
    await useEtat.getState().ouvrirProjet(p.id);
    useEtat.getState().modifierPlan((plan) => plan.pieces.push(pieceRectangle('Séjour', 500, 400)));
    for (let i = 1; i <= 10; i++) {
      useEtat.getState().modifierPlan((plan) => (plan.pieces[0].sommets[2].x = 500 + i), { cle: 'glisser-1' });
    }
    expect(planCourant(useEtat.getState())!.pieces[0].sommets[2].x).toBe(510);
    useEtat.getState().annuler();
    expect(planCourant(useEtat.getState())!.pieces[0].sommets[2].x).toBe(500);
  });

  it('crée le plan rénové par copie et le modifie sans toucher au plan actuel', async () => {
    const p = await useEtat.getState().creerProjet({ nom: 'Test' });
    await useEtat.getState().ouvrirProjet(p.id);
    useEtat.getState().modifierPlan((plan) => plan.pieces.push(pieceRectangle('Séjour', 500, 400)));
    useEtat.getState().choisirVariante('renove');
    const renove = planCourant(useEtat.getState())!;
    expect(renove.pieces).toHaveLength(1);
    useEtat.getState().modifierPlan((plan) => (plan.pieces[0].nom = 'Séjour-cuisine'));
    const niveau = useEtat.getState().projet!.niveaux[0];
    expect(niveau.actuel.pieces[0].nom).toBe('Séjour');
    expect(niveau.renove!.pieces[0].nom).toBe('Séjour-cuisine');
    // Même identifiant de pièce dans les deux plans.
    expect(niveau.renove!.pieces[0].id).toBe(niveau.actuel.pieces[0].id);
  });

  it('enregistre dans IndexedDB et recharge', async () => {
    const p = await useEtat.getState().creerProjet({ nom: 'Persistance' });
    await useEtat.getState().ouvrirProjet(p.id);
    useEtat.getState().modifierPlan((plan) => plan.pieces.push(pieceRectangle('Cuisine', 300, 250)));
    await useEtat.getState().enregistrerMaintenant();
    const relu = await persistance.lireProjet(p.id);
    expect(relu!.niveaux[0].actuel.pieces[0].nom).toBe('Cuisine');
    expect(useEtat.getState().enregistrement).toBe('enregistre');
  });

  it('supprime un chantier avec ses photos', async () => {
    const p = await useEtat.getState().creerProjet({ nom: 'À supprimer' });
    await useEtat.getState().ouvrirProjet(p.id);
    const photo = {
      id: 'ph1',
      projetId: p.id,
      niveauId: null,
      pieceId: null,
      position: null,
      legende: 'Façade',
      date: new Date().toISOString(),
      largeur: 10,
      hauteur: 10,
    };
    await useEtat.getState().ajouterPhoto(photo, { complete: new Blob(['a']), vignette: new Blob(['b']) });
    expect(await persistance.listerPhotos(p.id)).toHaveLength(1);
    await useEtat.getState().supprimerProjet(p.id);
    expect(await persistance.listerPhotos(p.id)).toHaveLength(0);
    expect(await persistance.lireImages('ph1')).toBeUndefined();
    expect(useEtat.getState().projet).toBeNull();
  });
});

describe('copie de secours (fermeture juste après une modification)', () => {
  beforeEach(async () => {
    const memoire = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: {
        get length() {
          return memoire.size;
        },
        key: (i: number) => [...memoire.keys()][i] ?? null,
        getItem: (k: string) => memoire.get(k) ?? null,
        setItem: (k: string, v: string) => void memoire.set(k, v),
        removeItem: (k: string) => void memoire.delete(k),
        clear: () => memoire.clear(),
      },
    });
    await reinitialiser();
  });

  it('reprend au démarrage la modification que IndexedDB n’a pas reçue', async () => {
    const p = await useEtat.getState().creerProjet({ nom: 'Secours' });
    await useEtat.getState().ouvrirProjet(p.id);
    useEtat.getState().modifierPlan((plan) => plan.pieces.push(pieceRectangle('Chambre', 300, 300)));
    // La page se ferme : copie synchrone, sans attendre l'écriture IndexedDB différée.
    sauverEnSecours();
    expect((await persistance.lireProjet(p.id))!.niveaux[0].actuel.pieces).toHaveLength(0);
    // Redémarrage de l'appli.
    useEtat.setState({ projets: [], projet: null, pret: false });
    await useEtat.getState().initialiser();
    const repris = useEtat.getState().projets.find((x) => x.id === p.id)!;
    expect(repris.niveaux[0].actuel.pieces[0].nom).toBe('Chambre');
    expect((await persistance.lireProjet(p.id))!.niveaux[0].actuel.pieces).toHaveLength(1);
    expect(lireSecours()).toHaveLength(0);
  });

  it('efface la copie une fois l’enregistrement confirmé, et ne restaure pas une copie plus ancienne', async () => {
    const p = await useEtat.getState().creerProjet({ nom: 'Secours 2' });
    await useEtat.getState().ouvrirProjet(p.id);
    useEtat.getState().modifierPlan((plan) => plan.pieces.push(pieceRectangle('Bureau', 300, 300)));
    sauverEnSecours();
    await useEtat.getState().enregistrerMaintenant();
    expect(lireSecours()).toHaveLength(0);
    // Copie périmée laissée par une ancienne session : ignorée.
    const ancienne = { ...structuredClone(useEtat.getState().projet!), modifieLe: '2000-01-01T00:00:00.000Z', nom: 'Ancien' };
    localStorage.setItem(`abse-plan-metre:secours:${p.id}`, JSON.stringify(ancienne));
    useEtat.setState({ projets: [], projet: null, pret: false });
    await useEtat.getState().initialiser();
    expect(useEtat.getState().projets.find((x) => x.id === p.id)!.nom).toBe('Secours 2');
    expect(lireSecours()).toHaveLength(0);
  });
});
