// Opérations des réglages sur le chantier (logique pure, testée).
// Les fonctions « supprimer… », « deplacer… », « ajouter… » modifient le
// brouillon reçu de modifierProjet.

import { TYPE_MUR_DEFAUT_ID } from '../../model/catalogue';
import { nouvelId } from '../../model/fabrique';
import type { Catalogue, ID, Niveau, Piece, Plan, Projet, RevetementSol, TypeMur } from '../../model/types';

/** Plans actuel et rénové de tous les niveaux. */
export function plansDuProjet(p: Projet): Plan[] {
  return p.niveaux.flatMap((n) => (n.renove ? [n.actuel, n.renove] : [n.actuel]));
}

function piecesDuProjet(p: Projet): Piece[] {
  return plansDuProjet(p).flatMap((plan) => plan.pieces);
}

/** Niveaux du plus bas (ordre 0) au plus haut. */
export function niveauxTries(p: Projet): Niveau[] {
  return [...p.niveaux].sort((a, b) => a.ordre - b.ordre);
}

function renumeroter(p: Projet): void {
  niveauxTries(p).forEach((n, i) => (n.ordre = i));
}

// ─── Niveaux ─────────────────────────────────────────────────────────────

/** Ajoute un niveau : « Sous-sol » se place sous les autres, le reste au-dessus. */
export function ajouterNiveau(p: Projet, niveau: Niveau): void {
  if (niveau.nom.trim().toLowerCase().startsWith('sous-sol')) {
    p.niveaux.forEach((x) => (x.ordre += 1));
    niveau.ordre = 0;
  } else {
    niveau.ordre = Math.max(-1, ...p.niveaux.map((x) => x.ordre)) + 1;
  }
  p.niveaux.push(niveau);
  renumeroter(p);
}

/** Échange le niveau avec son voisin du dessus (+1) ou du dessous (−1). false s'il est déjà au bout. */
export function deplacerNiveau(p: Projet, id: ID, sens: 1 | -1): boolean {
  const tries = niveauxTries(p);
  const i = tries.findIndex((n) => n.id === id);
  const j = i + sens;
  if (i < 0 || j < 0 || j >= tries.length) return false;
  [tries[i], tries[j]] = [tries[j], tries[i]];
  tries.forEach((n, k) => (n.ordre = k));
  return true;
}

/** Supprime le niveau (jamais le dernier). */
export function supprimerNiveau(p: Projet, id: ID): boolean {
  if (p.niveaux.length <= 1 || !p.niveaux.some((n) => n.id === id)) return false;
  p.niveaux = p.niveaux.filter((n) => n.id !== id);
  renumeroter(p);
  return true;
}

// ─── Types de murs ───────────────────────────────────────────────────────

/**
 * Nombre de pièces distinctes vérifiant `test`, tous plans confondus (une
 * pièce du plan actuel recopiée dans le plan rénové garde son identifiant).
 */
function compterPieces(p: Projet, test: (piece: Piece) => boolean): number {
  return new Set(piecesDuProjet(p).filter(test).map((piece) => piece.id)).size;
}

/** Nombre de pièces dont un mur au moins est de ce type. */
export function usageTypeMur(p: Projet, typeId: ID): number {
  return compterPieces(p, (piece) => piece.typeMurDefautId === typeId || piece.sommets.some((s) => s.typeMurId === typeId));
}

/** Type qui remplace un type supprimé : le type par défaut du catalogue s'il reste, sinon le premier restant. */
export function typeMurRemplacement(catalogue: Catalogue, typeIdSupprime: ID): TypeMur | null {
  const restants = catalogue.typesMurs.filter((t) => t.id !== typeIdSupprime);
  return restants.find((t) => t.id === TYPE_MUR_DEFAUT_ID) ?? restants[0] ?? null;
}

/**
 * Supprime un type de mur (jamais le dernier) et réaffecte les pièces et les
 * côtés concernés au type de remplacement.
 */
export function supprimerTypeMur(p: Projet, typeId: ID): boolean {
  const remplacant = typeMurRemplacement(p.catalogue, typeId);
  if (!remplacant || !p.catalogue.typesMurs.some((t) => t.id === typeId)) return false;
  p.catalogue.typesMurs = p.catalogue.typesMurs.filter((t) => t.id !== typeId);
  for (const piece of piecesDuProjet(p)) {
    if (piece.typeMurDefautId === typeId) piece.typeMurDefautId = remplacant.id;
    for (const s of piece.sommets) {
      if (s.typeMurId !== typeId) continue;
      // Côté ramené au type de la pièce s'il est identique (donnée plus simple), sinon explicite.
      if (piece.typeMurDefautId === remplacant.id) delete s.typeMurId;
      else s.typeMurId = remplacant.id;
    }
  }
  return true;
}

function nomLibre(base: string, pris: readonly string[]): string {
  const noms = new Set(pris);
  if (!noms.has(base)) return base;
  let n = 2;
  while (noms.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function nouveauTypeMur(catalogue: Catalogue): TypeMur {
  return {
    id: nouvelId(),
    nom: nomLibre('Nouveau type de mur', catalogue.typesMurs.map((t) => t.nom)),
    epaisseur: 10,
  };
}

// ─── Revêtements de sol ──────────────────────────────────────────────────

/** Nombre de pièces revêtues de ce revêtement. */
export function usageRevetement(p: Projet, id: ID): number {
  return compterPieces(p, (piece) => piece.revetementSolId === id);
}

/** Supprime le revêtement ; les pièces concernées passent à « non renseigné ». */
export function supprimerRevetement(p: Projet, id: ID): boolean {
  if (!p.catalogue.revetementsSol.some((r) => r.id === id)) return false;
  p.catalogue.revetementsSol = p.catalogue.revetementsSol.filter((r) => r.id !== id);
  for (const piece of piecesDuProjet(p)) {
    if (piece.revetementSolId === id) piece.revetementSolId = null;
  }
  return true;
}

/** Couleurs proposées aux nouveaux revêtements (la première encore libre). */
const COULEURS_REVETEMENTS = ['#e3c79a', '#9fb7c9', '#c9a3a3', '#a9c4a0', '#d6d1c4', '#b7a6cf', '#e0b483'];

export function nouveauRevetement(catalogue: Catalogue): RevetementSol {
  const prises = new Set(catalogue.revetementsSol.map((r) => r.couleur.toLowerCase()));
  return {
    id: nouvelId(),
    nom: nomLibre('Nouveau revêtement', catalogue.revetementsSol.map((r) => r.nom)),
    couleur: COULEURS_REVETEMENTS.find((c) => !prises.has(c)) ?? COULEURS_REVETEMENTS[catalogue.revetementsSol.length % COULEURS_REVETEMENTS.length],
  };
}
