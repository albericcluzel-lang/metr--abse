// État global de l'appli (zustand).
//
// Principe : toute modification du chantier ouvert passe par
// `modifierProjet` / `modifierPlan`, qui travaillent sur une copie, gardent
// l'historique (annuler / rétablir) et déclenchent l'enregistrement
// automatique.

import { create } from 'zustand';
import { copierPlanPourRenovation, maintenantIso, nouveauProjet } from '../model/fabrique';
import type { ID, Niveau, Photo, Plan, Projet, Selection, Variante } from '../model/types';
import * as persistance from './persistance';

export interface OptionsModification {
  /**
   * Regroupe les modifications successives portant la même clé en une seule
   * étape d'annulation (ex. `deplacer-sommet-<id du geste>` pendant un glisser).
   */
  cle?: string;
}

interface EntreeHistorique {
  projet: Projet;
  cle?: string;
}

export type EtatEnregistrement = 'enregistre' | 'en-attente' | 'erreur';

export interface EtatApp {
  pret: boolean;
  projets: Projet[];
  /** Chantier ouvert. */
  projet: Projet | null;
  niveauId: ID | null;
  variante: Variante;
  selection: Selection | null;
  passe: EntreeHistorique[];
  futur: EntreeHistorique[];
  /** Photos du chantier ouvert (métadonnées). */
  photos: Photo[];
  enregistrement: EtatEnregistrement;

  initialiser(): Promise<void>;
  creerProjet(infos: { nom: string; client?: string; adresse?: string }): Promise<Projet>;
  /** Ajoute (import) un chantier complet déjà construit. */
  importerProjet(projet: Projet): Promise<void>;
  ouvrirProjet(id: ID): Promise<boolean>;
  fermerProjet(): void;
  supprimerProjet(id: ID): Promise<void>;

  modifierProjet(fn: (p: Projet) => void, options?: OptionsModification): void;
  /** Modifie le plan affiché (niveau et variante courants). */
  modifierPlan(fn: (plan: Plan, niveau: Niveau) => void, options?: OptionsModification): void;
  annuler(): void;
  retablir(): void;

  choisirNiveau(id: ID): void;
  /** Passe sur le plan rénové en le créant (copie du plan actuel) s'il n'existe pas. */
  choisirVariante(v: Variante): void;
  selectionner(s: Selection | null): void;

  ajouterPhoto(photo: Photo, images: persistance.ImagesPhoto): Promise<void>;
  modifierPhoto(id: ID, changements: Partial<Omit<Photo, 'id' | 'projetId'>>): Promise<void>;
  supprimerPhoto(id: ID): Promise<void>;

  /** Force l'écriture immédiate (ex. avant de quitter la page). */
  enregistrerMaintenant(): Promise<void>;
}

const TAILLE_HISTORIQUE = 100;
const DELAI_ENREGISTREMENT = 400;

let minuteur: ReturnType<typeof setTimeout> | null = null;
let aEnregistrer: Projet | null = null;

export function niveauCourant(etat: Pick<EtatApp, 'projet' | 'niveauId'>): Niveau | null {
  const p = etat.projet;
  if (!p) return null;
  return p.niveaux.find((n) => n.id === etat.niveauId) ?? premierNiveau(p);
}

/** Plan affiché : plan rénové si demandé et existant, sinon plan actuel. */
export function planCourant(etat: Pick<EtatApp, 'projet' | 'niveauId' | 'variante'>): Plan | null {
  const n = niveauCourant(etat);
  if (!n) return null;
  return etat.variante === 'renove' ? (n.renove ?? n.actuel) : n.actuel;
}

function premierNiveau(p: Projet): Niveau | null {
  return [...p.niveaux].sort((a, b) => a.ordre - b.ordre)[0] ?? null;
}

/** La sélection désigne-t-elle encore quelque chose dans le plan ? */
export function selectionValide(sel: Selection | null, plan: Plan | null, photos: Photo[]): boolean {
  if (!sel) return true;
  if (sel.type === 'photo') return photos.some((p) => p.id === sel.photoId);
  const piece = plan?.pieces.find((p) => p.id === sel.pieceId);
  if (!piece) return false;
  switch (sel.type) {
    case 'piece':
      return true;
    case 'sommet':
    case 'cote':
      return sel.index >= 0 && sel.index < piece.sommets.length;
    case 'ouverture':
      return piece.ouvertures.some((o) => o.id === sel.ouvertureId);
    case 'equipement':
      return piece.equipements.some((e) => e.id === sel.equipementId);
  }
}

export const useEtat = create<EtatApp>()((set, get) => {
  function planifierEnregistrement(projet: Projet) {
    aEnregistrer = projet;
    set({ enregistrement: 'en-attente' });
    if (minuteur) clearTimeout(minuteur);
    minuteur = setTimeout(() => void get().enregistrerMaintenant(), DELAI_ENREGISTREMENT);
  }

  /** Remplace le chantier ouvert et répercute dans la liste. */
  function remplacer(projet: Projet, extra: Partial<EtatApp> = {}) {
    const projets = get().projets.map((p) => (p.id === projet.id ? projet : p));
    set({ projet, projets, ...extra });
    planifierEnregistrement(projet);
  }

  function nettoyerSelection() {
    const e = get();
    if (!selectionValide(e.selection, planCourant(e), e.photos)) set({ selection: null });
  }

  return {
    pret: false,
    projets: [],
    projet: null,
    niveauId: null,
    variante: 'actuel',
    selection: null,
    passe: [],
    futur: [],
    photos: [],
    enregistrement: 'enregistre',

    async initialiser() {
      const projets = await persistance.listerProjets();
      set({ projets, pret: true });
      void persistance.demanderStockagePersistant();
    },

    async creerProjet(infos) {
      const projet = nouveauProjet(infos);
      await persistance.enregistrerProjet(projet);
      set({ projets: [projet, ...get().projets] });
      return projet;
    },

    async importerProjet(projet) {
      await persistance.enregistrerProjet(projet);
      set({ projets: [projet, ...get().projets.filter((p) => p.id !== projet.id)] });
    },

    async ouvrirProjet(id) {
      if (get().projet?.id === id) return true;
      await get().enregistrerMaintenant();
      const projet = get().projets.find((p) => p.id === id) ?? (await persistance.lireProjet(id));
      if (!projet) return false;
      const photos = await persistance.listerPhotos(id);
      set({
        projet,
        niveauId: premierNiveau(projet)?.id ?? null,
        variante: 'actuel',
        selection: null,
        passe: [],
        futur: [],
        photos,
      });
      return true;
    },

    fermerProjet() {
      void get().enregistrerMaintenant();
      set({ projet: null, niveauId: null, selection: null, passe: [], futur: [], photos: [] });
    },

    async supprimerProjet(id) {
      if (aEnregistrer?.id === id) {
        aEnregistrer = null;
        if (minuteur) clearTimeout(minuteur);
      }
      await persistance.supprimerProjet(id);
      const extra = get().projet?.id === id ? { projet: null, photos: [], passe: [], futur: [], selection: null } : {};
      set({ projets: get().projets.filter((p) => p.id !== id), ...extra });
    },

    modifierProjet(fn, options = {}) {
      const avant = get().projet;
      if (!avant) return;
      const brouillon = structuredClone(avant);
      fn(brouillon);
      brouillon.modifieLe = maintenantIso();
      const passe = get().passe;
      const derniere = passe[passe.length - 1];
      const fusion = options.cle !== undefined && derniere?.cle === options.cle;
      const nouveauPasse = fusion ? passe : [...passe, { projet: avant, cle: options.cle }].slice(-TAILLE_HISTORIQUE);
      remplacer(brouillon, { passe: nouveauPasse, futur: [] });
      nettoyerSelection();
    },

    modifierPlan(fn, options) {
      const { variante } = get();
      const niveau = niveauCourant(get());
      if (!niveau) return;
      get().modifierProjet((p) => {
        const n = p.niveaux.find((x) => x.id === niveau.id)!;
        if (variante === 'renove') {
          if (!n.renove) n.renove = copierPlanPourRenovation(n.actuel);
          fn(n.renove, n);
        } else {
          fn(n.actuel, n);
        }
      }, options);
    },

    annuler() {
      const { passe, futur, projet } = get();
      const prec = passe[passe.length - 1];
      if (!prec || !projet) return;
      remplacer(prec.projet, { passe: passe.slice(0, -1), futur: [...futur, { projet }] });
      nettoyerSelection();
    },

    retablir() {
      const { passe, futur, projet } = get();
      const suiv = futur[futur.length - 1];
      if (!suiv || !projet) return;
      remplacer(suiv.projet, { passe: [...passe, { projet }], futur: futur.slice(0, -1) });
      nettoyerSelection();
    },

    choisirNiveau(id) {
      set({ niveauId: id, selection: null });
    },

    choisirVariante(v) {
      if (v === 'renove') {
        const n = niveauCourant(get());
        if (n && !n.renove) {
          set({ variante: v, selection: null });
          get().modifierProjet((p) => {
            const cible = p.niveaux.find((x) => x.id === n.id)!;
            cible.renove = copierPlanPourRenovation(cible.actuel);
          });
          return;
        }
      }
      set({ variante: v, selection: null });
    },

    selectionner(s) {
      set({ selection: s });
    },

    async ajouterPhoto(photo, images) {
      await persistance.enregistrerPhoto(photo, images);
      if (get().projet?.id === photo.projetId) set({ photos: [...get().photos, photo] });
    },

    async modifierPhoto(id, changements) {
      const ancienne = get().photos.find((p) => p.id === id);
      if (!ancienne) return;
      const photo = { ...ancienne, ...changements };
      await persistance.enregistrerPhoto(photo);
      set({ photos: get().photos.map((p) => (p.id === id ? photo : p)) });
    },

    async supprimerPhoto(id) {
      await persistance.supprimerPhoto(id);
      const sel = get().selection;
      set({
        photos: get().photos.filter((p) => p.id !== id),
        selection: sel?.type === 'photo' && sel.photoId === id ? null : sel,
      });
    },

    async enregistrerMaintenant() {
      if (minuteur) {
        clearTimeout(minuteur);
        minuteur = null;
      }
      const projet = aEnregistrer;
      aEnregistrer = null;
      if (!projet) return;
      try {
        await persistance.enregistrerProjet(projet);
        if (!aEnregistrer) set({ enregistrement: 'enregistre' });
      } catch (e) {
        console.error('Enregistrement impossible', e);
        aEnregistrer = aEnregistrer ?? projet;
        set({ enregistrement: 'erreur' });
      }
    },
  };
});

/** Enregistre dès que l'appli passe en arrière-plan (Android peut la fermer ensuite). */
export function brancherEnregistrementAutomatique(): () => void {
  const flush = () => {
    if (document.visibilityState === 'hidden') void useEtat.getState().enregistrerMaintenant();
  };
  const avantDeQuitter = () => void useEtat.getState().enregistrerMaintenant();
  document.addEventListener('visibilitychange', flush);
  window.addEventListener('pagehide', avantDeQuitter);
  return () => {
    document.removeEventListener('visibilitychange', flush);
    window.removeEventListener('pagehide', avantDeQuitter);
  };
}
