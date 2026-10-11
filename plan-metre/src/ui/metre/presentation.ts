// Mise en forme du métré pour l'écran, l'impression et le presse-papiers.
//
// Le moteur (metre/calcul.ts) fournit les quantités ; ce module les range en
// blocs (tout le chantier, un niveau ou une pièce) puis en sections
// (« SURFACES », « VOLUME »…), pour un plan (actuel ou rénové) ou pour les
// deux en regard (comparaison, avec l'écart rénové − actuel).
//
// Aucune dépendance au DOM : tout est testé dans presentation.test.ts.

import {
  arrondir,
  comparerLignes,
  formaterEcart,
  formaterValeur,
  lignesMetre,
  metreProjet,
  SECTIONS_METRE,
  type DetailMetre,
  type LigneMetre,
  type MetreProjet,
  type SectionMetre,
  type UniteMetre,
} from '../../metre/calcul';
import type { Catalogue, ID, Niveau, ParametresMetre, Projet, Variante } from '../../model/types';

/** Plan présenté : un seul plan, ou les deux en comparaison. */
export type ModeMetre = Variante | 'comparer';
export type OngletMetre = 'global' | 'etage' | 'piece';

export const LIBELLES_MODES: Record<ModeMetre, string> = {
  actuel: 'Plan actuel',
  renove: 'Plan rénové',
  comparer: 'Comparaison plan actuel / plan rénové',
};

export const LIBELLES_ONGLETS: Record<OngletMetre, string> = {
  global: 'Global',
  etage: 'Par étage',
  piece: 'Par pièce',
};

export interface LigneTableau {
  cle: string;
  section: SectionMetre;
  libelle: string;
  precision?: string;
  unite: UniteMetre;
  /**
   * Une valeur par plan présenté : [valeur] pour un seul plan, [actuel, rénové]
   * en comparaison. null : la ligne n'existe pas dans ce plan.
   */
  valeurs: (number | null)[];
  /** Écart rénové − actuel (comparaison uniquement). */
  ecart?: number;
}

export interface SectionTableau {
  id: SectionMetre;
  titre: string;
  sousTitre?: string;
  lignes: LigneTableau[];
}

/** Ce qui résume un bloc : nombre de pièces et surface au sol (m²), par plan présenté. */
export interface ResumeBloc {
  pieces: (number | null)[];
  surface: (number | null)[];
}

export interface BlocMetre {
  /** Clé stable : 'global', `niveau:<id>` ou `piece:<niveau>:<pièce>`. */
  cle: string;
  titre: string;
  niveauId: ID | null;
  pieceId: ID | null;
  resume: ResumeBloc;
  sections: SectionTableau[];
  /** Pièce : variante à afficher sur le plan pour la retrouver. */
  varianteCible?: Variante;
  /** Comparaison : la pièce n'existe que dans un des deux plans. */
  statut?: 'nouvelle' | 'supprimee';
  /** Remarque affichée sous le titre (ex. niveau sans plan rénové). */
  note?: string;
}

export interface GroupeMetre {
  cle: string;
  /** Titre du groupe (nom du niveau en vue « Par pièce »). */
  titre?: string;
  note?: string;
  blocs: BlocMetre[];
}

export interface VueMetre {
  mode: ModeMetre;
  onglet: OngletMetre;
  /** En-têtes des colonnes de valeurs. */
  colonnes: string[];
  groupes: GroupeMetre[];
  /** Aucune pièce dans le ou les plans présentés. */
  vide: boolean;
  /** Aucun niveau n'a de plan rénové (le plan rénové est alors le plan actuel). */
  aucunPlanRenove: boolean;
  /** Niveaux sans plan rénové, réputés inchangés (modes rénové et comparaison). */
  niveauxInchanges: string[];
}

export interface MetresProjet {
  actuel: MetreProjet;
  renove: MetreProjet;
}

export function calculerMetres(projet: Projet): MetresProjet {
  return { actuel: metreProjet(projet, 'actuel'), renove: metreProjet(projet, 'renove') };
}

export const NOTE_NIVEAU_INCHANGE = 'Pas de plan rénové : niveau réputé inchangé';
export const NOTE_AUCUNE_PIECE = 'Aucune pièce sur ce niveau';

/** Sous-titre de la section « Surfaces à peindre » selon les réglages du chantier. */
export function sousTitrePeinture(parametres: ParametresMetre): string {
  if (!parametres.deduireOuvertures) return 'Ouvertures non déduites';
  const seuil = Math.max(0, parametres.seuilDeductionOuverture);
  return seuil > 0 ? `Hors ouvrants de plus de ${formaterValeur(seuil, 'm²')}` : 'Hors ouvrants';
}

function sousTitreSection(id: SectionMetre, parametres: ParametresMetre): string | undefined {
  return id === 'peinture' ? sousTitrePeinture(parametres) : undefined;
}

/** Range des lignes (déjà ordonnées) dans les sections, sans les sections vides. */
export function regrouperEnSections(lignes: readonly LigneTableau[], parametres: ParametresMetre): SectionTableau[] {
  return SECTIONS_METRE.map((s) => ({
    id: s.id,
    titre: s.titre,
    sousTitre: sousTitreSection(s.id, parametres),
    lignes: lignes.filter((l) => l.section === s.id),
  })).filter((s) => s.lignes.length > 0);
}

/** Lignes d'un détail, ou null si le détail ne contient aucune pièce. */
function lignesOuRien(d: DetailMetre | undefined, catalogue: Catalogue): LigneMetre[] | null {
  return d && d.nombrePieces > 0 ? lignesMetre(d, catalogue) : null;
}

/** Sections d'un seul plan. */
export function sectionsSimples(d: DetailMetre | undefined, catalogue: Catalogue, parametres: ParametresMetre): SectionTableau[] {
  const lignes = lignesOuRien(d, catalogue);
  if (!lignes) return [];
  return regrouperEnSections(
    lignes.map((l) => ({ cle: l.cle, section: l.section, libelle: l.libelle, precision: l.precision, unite: l.unite, valeurs: [l.valeur] })),
    parametres,
  );
}

/** Sections de deux plans mis en regard. Un détail absent ou sans pièce donne des cases vides. */
export function sectionsComparees(
  actuel: DetailMetre | undefined,
  renove: DetailMetre | undefined,
  catalogue: Catalogue,
  parametres: ParametresMetre,
): SectionTableau[] {
  const la = lignesOuRien(actuel, catalogue);
  const lr = lignesOuRien(renove, catalogue);
  if (!la && !lr) return [];
  const dansA = new Set((la ?? []).map((l) => l.cle));
  const dansR = new Set((lr ?? []).map((l) => l.cle));
  return regrouperEnSections(
    comparerLignes(la ?? [], lr ?? []).map((c) => ({
      cle: c.cle,
      section: c.section,
      libelle: c.libelle,
      precision: c.precision,
      unite: c.unite,
      valeurs: [dansA.has(c.cle) ? c.actuel : null, dansR.has(c.cle) ? c.renove : null],
      ecart: c.ecart,
    })),
    parametres,
  );
}

function resume(details: (DetailMetre | undefined)[]): ResumeBloc {
  return {
    pieces: details.map((d) => (d ? d.nombrePieces : null)),
    surface: details.map((d) => (d ? d.surfaceSol / 1e4 : null)),
  };
}

/** Écart rénové − actuel d'une paire de valeurs (une valeur absente compte pour 0). */
export function ecartValeurs(valeurs: readonly (number | null)[]): number {
  return (valeurs[1] ?? 0) - (valeurs[0] ?? 0);
}

function niveauxTries(projet: Projet): Niveau[] {
  return [...projet.niveaux].sort((a, b) => a.ordre - b.ordre);
}

/** Variante à ouvrir sur le plan pour montrer une pièce, sans jamais créer de plan rénové. */
export function varianteCiblePiece(niveau: Niveau | undefined, pieceId: ID, mode: ModeMetre): Variante {
  if (!niveau?.renove || mode === 'actuel') return 'actuel';
  if (mode === 'renove') return 'renove';
  return niveau.renove.pieces.some((p) => p.id === pieceId) ? 'renove' : 'actuel';
}

/**
 * Construit la vue affichée : un groupe par niveau en « Par pièce », un seul
 * groupe sinon (un bloc pour tout le chantier, ou un bloc par niveau).
 */
export function construireVueMetre(projet: Projet, metres: MetresProjet, mode: ModeMetre, onglet: OngletMetre): VueMetre {
  const { catalogue, parametres } = projet;
  const comparer = mode === 'comparer';
  // Plans présentés, dans l'ordre des colonnes.
  const plans: MetreProjet[] = mode === 'actuel' ? [metres.actuel] : mode === 'renove' ? [metres.renove] : [metres.actuel, metres.renove];
  const sections = (details: (DetailMetre | undefined)[]) =>
    comparer ? sectionsComparees(details[0], details[1], catalogue, parametres) : sectionsSimples(details[0], catalogue, parametres);

  const niveaux = niveauxTries(projet);
  const niveauxInchanges = mode === 'actuel' ? [] : niveaux.filter((n) => !n.renove).map((n) => n.nom);
  const noteNiveau = (n: Niveau) => (mode !== 'actuel' && !n.renove ? NOTE_NIVEAU_INCHANGE : undefined);

  const groupes: GroupeMetre[] = [];
  if (onglet === 'global') {
    const details = plans.map((m) => m.global);
    groupes.push({
      cle: 'global',
      blocs: [{ cle: 'global', titre: 'Tout le chantier', niveauId: null, pieceId: null, resume: resume(details), sections: sections(details) }],
    });
  } else if (onglet === 'etage') {
    groupes.push({
      cle: 'etages',
      blocs: niveaux.map((n) => {
        const details = plans.map((m) => m.parNiveau.find((x) => x.niveauId === n.id)?.detail);
        const vide = details.every((d) => !d || d.nombrePieces === 0);
        return {
          cle: `niveau:${n.id}`,
          titre: n.nom,
          niveauId: n.id,
          pieceId: null,
          resume: resume(details),
          sections: sections(details),
          note: vide ? NOTE_AUCUNE_PIECE : noteNiveau(n),
        };
      }),
    });
  } else {
    for (const n of niveaux) {
      // Pièces du niveau dans l'ordre du premier plan, puis celles propres au second.
      const ids: ID[] = [];
      const noms = new Map<ID, string>();
      for (const m of plans) {
        for (const p of m.parPiece) {
          if (p.niveauId !== n.id) continue;
          if (!noms.has(p.pieceId)) ids.push(p.pieceId);
          noms.set(p.pieceId, p.pieceNom); // le nom du plan rénové l'emporte
        }
      }
      const blocs = ids.map((pieceId): BlocMetre => {
        const details = plans.map((m) => m.parPiece.find((p) => p.niveauId === n.id && p.pieceId === pieceId)?.detail);
        return {
          cle: `piece:${n.id}:${pieceId}`,
          titre: noms.get(pieceId) || 'Pièce sans nom',
          niveauId: n.id,
          pieceId,
          resume: resume(details),
          sections: sections(details),
          varianteCible: varianteCiblePiece(n, pieceId, mode),
          statut: comparer && !details[0] ? 'nouvelle' : comparer && !details[1] ? 'supprimee' : undefined,
        };
      });
      groupes.push({
        cle: `niveau:${n.id}`,
        titre: n.nom,
        note: blocs.length === 0 ? NOTE_AUCUNE_PIECE : noteNiveau(n),
        blocs,
      });
    }
  }

  return {
    mode,
    onglet,
    colonnes: comparer ? ['Actuel', 'Rénové', 'Écart'] : ['Quantité'],
    groupes,
    vide: plans.every((m) => m.global.nombrePieces === 0),
    aucunPlanRenove: projet.niveaux.every((n) => !n.renove),
    niveauxInchanges,
  };
}

// ─── Formats d'affichage ─────────────────────────────────────────────────

/** « 1 pièce », « 3 pièces ». */
export function formaterPieces(n: number): string {
  return `${n} pièce${n > 1 ? 's' : ''}`;
}

/** Valeur d'une case : « 3,57 m² », ou un tiret si la ligne n'existe pas dans ce plan. */
export function formaterCase(v: number | null, unite: UniteMetre): string {
  return v === null ? '—' : formaterValeur(v, unite);
}

/** L'écart arrondi est-il non nul (à mettre en évidence) ? */
export function ecartNonNul(ecart: number, unite: UniteMetre): boolean {
  return formaterEcart(ecart, unite) !== '=';
}

/** Comparaison : le bloc diffère-t-il entre les deux plans (au centième près) ? */
export function blocModifie(b: BlocMetre): boolean {
  if (b.statut) return true;
  if (Math.round(ecartValeurs(b.resume.pieces)) !== 0) return true;
  return b.sections.some((s) => s.lignes.some((l) => ecartNonNul(l.ecart ?? ecartValeurs(l.valeurs), l.unite)));
}

/** Écart d'un nombre de pièces : « +1 », « −2 », « = ». */
export function formaterEcartPieces(ecart: number): string {
  const r = Math.round(ecart);
  if (r === 0) return '=';
  return `${r > 0 ? '+' : '−'}${Math.abs(r)}`;
}

// ─── Presse-papiers (Excel, devis) ───────────────────────────────────────

export interface EnteteMetre {
  nom: string;
  client?: string;
  adresse?: string;
  /** Date d'édition déjà mise en forme. */
  date: string;
}

/** Nombre pour un tableur français : virgule décimale, ni espace ni symbole d'unité. */
export function nombreTableur(v: number, unite: UniteMetre): string {
  if (unite === 'u') return String(Math.round(v));
  return arrondir(v, 2).toFixed(2).replace('.', ',');
}

/** Écart signé pour un tableur (« +1,20 », « -0,40 », « 0,00 »). */
export function ecartTableur(v: number, unite: UniteMetre): string {
  const r = unite === 'u' ? Math.round(v) : arrondir(v, 2);
  const txt = nombreTableur(Math.abs(r), unite);
  return r > 0 ? `+${txt}` : r < 0 ? `-${txt}` : txt;
}

/** Texte saisi par l'utilisateur, rendu sûr pour une cellule (ni tabulation ni retour à la ligne). */
function cellule(texte: string): string {
  return texte.replace(/[\t\r\n]+/g, ' ').trim();
}

function titreSectionTexte(s: SectionTableau): string {
  const titre = s.titre.toLocaleUpperCase('fr-FR');
  return s.sousTitre ? `${titre} (${s.sousTitre.toLocaleUpperCase('fr-FR')})` : titre;
}

function ligneTexte(l: LigneTableau, comparer: boolean): string {
  const libelle = cellule(l.precision ? `${l.libelle} (${l.precision})` : l.libelle);
  const valeurs = l.valeurs.map((v) => (v === null ? '' : nombreTableur(v, l.unite)));
  if (comparer) valeurs.push(ecartTableur(l.ecart ?? ecartValeurs(l.valeurs), l.unite));
  return [libelle, ...valeurs, l.unite].join('\t');
}

function resumeTexte(r: ResumeBloc, comparer: boolean): string[] {
  const pieces = r.pieces.map((v) => (v === null ? '' : String(v)));
  const surface = r.surface.map((v) => (v === null ? '' : nombreTableur(v, 'm²')));
  if (comparer) {
    pieces.push(ecartTableur(ecartValeurs(r.pieces), 'u'));
    surface.push(ecartTableur(ecartValeurs(r.surface), 'm²'));
  }
  return [['Nombre de pièces', ...pieces, ''].join('\t'), ['Surface totale', ...surface, 'm²'].join('\t')];
}

/**
 * Texte tabulé de la vue affichée, à coller dans Excel (une valeur par
 * cellule) ou dans un devis. Colonnes : désignation, quantité(s), unité.
 */
export function texteTabule(vue: VueMetre, entete: EnteteMetre): string {
  const comparer = vue.mode === 'comparer';
  const lignes: string[] = [`Métré — ${cellule(entete.nom)}`];
  if (entete.client?.trim()) lignes.push(`Client : ${cellule(entete.client)}`);
  if (entete.adresse?.trim()) lignes.push(`Adresse : ${cellule(entete.adresse)}`);
  lignes.push(`${LIBELLES_MODES[vue.mode]} — ${LIBELLES_ONGLETS[vue.onglet]} — ${entete.date}`);
  if (vue.mode !== 'actuel' && vue.niveauxInchanges.length > 0) {
    lignes.push(`Sans plan rénové (réputé inchangé) : ${vue.niveauxInchanges.map(cellule).join(', ')}`);
  }
  lignes.push('', ['Désignation', ...vue.colonnes, 'Unité'].join('\t'));

  for (const g of vue.groupes) {
    if (g.titre) {
      lignes.push('', cellule(g.titre).toLocaleUpperCase('fr-FR'));
      if (g.note) lignes.push(g.note);
    }
    for (const b of g.blocs) {
      const statut = b.statut === 'nouvelle' ? ' (nouvelle pièce)' : b.statut === 'supprimee' ? ' (pièce supprimée)' : '';
      lignes.push('', `${cellule(b.titre)}${statut}`);
      if (b.note) lignes.push(b.note);
      if (vue.onglet !== 'piece' && b.sections.length > 0) lignes.push(...resumeTexte(b.resume, comparer));
      for (const s of b.sections) {
        lignes.push(titreSectionTexte(s));
        for (const l of s.lignes) lignes.push(ligneTexte(l, comparer));
      }
    }
  }
  return `${lignes.join('\n')}\n`;
}
