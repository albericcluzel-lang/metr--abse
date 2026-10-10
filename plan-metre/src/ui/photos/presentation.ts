// Classement et libellés des photos du chantier (logique pure, testée).

import { planDuNiveau } from '../../metre/calcul';
import type { ID, Niveau, Photo, Piece, Projet, Variante } from '../../model/types';
import { jourPourFichier, nomPourFichier } from '../../store/sauvegarde';

export interface GroupePiece {
  cle: string;
  pieceId: ID | null;
  /** null : pas de sous-titre (photos sans niveau). */
  titre: string | null;
  photos: Photo[];
}

export interface GroupeNiveau {
  cle: string;
  niveauId: ID | null;
  titre: string;
  nombre: number;
  pieces: GroupePiece[];
}

export const SANS_PIECE = 'Sans pièce';
export const SANS_NIVEAU = 'Sans niveau';

/**
 * Pièces du niveau : celles du plan affiché, puis celles qui n'existent que
 * dans l'autre plan (une photo peut y être rattachée).
 */
export function piecesDuNiveau(niveau: Niveau, variante: Variante): Piece[] {
  const affiche = planDuNiveau(niveau, variante).pieces;
  const autre = planDuNiveau(niveau, variante === 'renove' ? 'actuel' : 'renove').pieces;
  const ids = new Set(affiche.map((p) => p.id));
  return [...affiche, ...autre.filter((p) => !ids.has(p.id))];
}

function parDate(a: Photo, b: Photo): number {
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

/**
 * Photos groupées par niveau (du plus bas au plus haut), puis par pièce dans
 * l'ordre du plan, puis « Sans pièce » ; enfin « Sans niveau ». Les photos
 * rattachées à un niveau ou une pièce supprimés rejoignent « Sans … ».
 */
export function regrouperPhotos(photos: readonly Photo[], projet: Projet, variante: Variante): GroupeNiveau[] {
  const triees = [...photos].sort(parDate);
  const niveaux = [...projet.niveaux].sort((a, b) => a.ordre - b.ordre);
  const idsNiveaux = new Set(niveaux.map((n) => n.id));
  const groupes: GroupeNiveau[] = [];

  for (const niveau of niveaux) {
    const duNiveau = triees.filter((p) => p.niveauId === niveau.id);
    if (duNiveau.length === 0) continue;
    const pieces = piecesDuNiveau(niveau, variante);
    const sousGroupes: GroupePiece[] = [];
    for (const piece of pieces) {
      const liste = duNiveau.filter((p) => p.pieceId === piece.id);
      if (liste.length > 0) sousGroupes.push({ cle: `${niveau.id}:${piece.id}`, pieceId: piece.id, titre: piece.nom || 'Pièce sans nom', photos: liste });
    }
    const idsPieces = new Set(pieces.map((p) => p.id));
    const sans = duNiveau.filter((p) => p.pieceId === null || !idsPieces.has(p.pieceId));
    if (sans.length > 0) sousGroupes.push({ cle: `${niveau.id}:-`, pieceId: null, titre: SANS_PIECE, photos: sans });
    groupes.push({ cle: niveau.id, niveauId: niveau.id, titre: niveau.nom, nombre: duNiveau.length, pieces: sousGroupes });
  }

  const orphelines = triees.filter((p) => p.niveauId === null || !idsNiveaux.has(p.niveauId));
  if (orphelines.length > 0) {
    groupes.push({
      cle: '-',
      niveauId: null,
      titre: SANS_NIVEAU,
      nombre: orphelines.length,
      pieces: [{ cle: '-:-', pieceId: null, titre: null, photos: orphelines }],
    });
  }
  return groupes;
}

/** Ordre de défilement dans la visionneuse : celui de la grille. */
export function ordreAffichage(groupes: readonly GroupeNiveau[]): Photo[] {
  return groupes.flatMap((g) => g.pieces.flatMap((p) => p.photos));
}

/** « 10 octobre 2026 à 09:05 ». */
export function formaterDatePhoto(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const jour = d.getDate() === 1 ? '1er' : String(d.getDate());
  const mois = d.toLocaleDateString('fr-FR', { month: 'long' });
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${jour} ${mois} ${d.getFullYear()} à ${heure}`;
}

/** Libellé d'une vignette pour les lecteurs d'écran. */
export function libellePhoto(p: Photo): string {
  const date = formaterDatePhoto(p.date);
  return p.legende.trim() ? `${p.legende.trim()} (photo du ${date})` : `Photo du ${date}`;
}

/** « villa-dupont-fissure-plafond-2026-10-10.jpg ». */
export function nomFichierPhoto(nomChantier: string, p: Photo): string {
  const morceaux = [nomPourFichier(nomChantier)];
  const legende = nomPourFichier(p.legende, '');
  if (legende) morceaux.push(legende.slice(0, 40).replace(/-+$/, ''));
  const d = new Date(p.date);
  morceaux.push(Number.isNaN(d.getTime()) ? 'photo' : jourPourFichier(d));
  return `${morceaux.join('-')}.jpg`;
}

/** « Préparation 2/5… » : fichier en cours (à partir de 1) sur le total. */
export function texteProgression(fait: number, total: number): string {
  return total > 1 ? `Préparation ${Math.min(fait + 1, total)}/${total}…` : 'Préparation de la photo…';
}
