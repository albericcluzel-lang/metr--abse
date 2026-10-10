// Actions de l'éditeur de plan qui passent par l'état global : chacune est
// une étape d'annulation (ou se regroupe avec ses voisines par `cle`).

import { dupliquerPiece } from '../../model/fabrique';
import type { ID, Piece, TypeOuverture } from '../../model/types';
import { planCourant, useEtat, type OptionsModification } from '../../store/etat';
import { confirmer, notifier } from '../commun/dialogues';
import { insererSommet, orthogonaliserPiece, ouvertureSurCote, supprimerSommet } from './operations';

/** Pièce du plan affiché. */
export function pieceDuPlan(id: ID): Piece | null {
  return planCourant(useEtat.getState())?.pieces.find((p) => p.id === id) ?? null;
}

/**
 * Modifie une pièce du plan affiché. `fn` reçoit une copie modifiable ; elle
 * peut la modifier sur place ou renvoyer une nouvelle pièce.
 */
export function modifierPiece(pieceId: ID, fn: (p: Piece) => Piece | void, options?: OptionsModification): void {
  useEtat.getState().modifierPlan((plan) => {
    const i = plan.pieces.findIndex((p) => p.id === pieceId);
    if (i < 0) return;
    const r = fn(plan.pieces[i]);
    if (r) plan.pieces[i] = r;
  }, options);
}

export async function supprimerPiece(pieceId: ID): Promise<void> {
  const piece = pieceDuPlan(pieceId);
  if (!piece) return;
  const ok = await confirmer({
    titre: `Supprimer « ${piece.nom || 'Sans nom'} » ?`,
    message: 'La pièce, ses ouvertures et ses équipements seront retirés de ce plan.',
    libelleConfirmer: 'Supprimer',
    danger: true,
  });
  if (!ok) return;
  useEtat.getState().modifierPlan((plan) => {
    plan.pieces = plan.pieces.filter((p) => p.id !== pieceId);
  });
  useEtat.getState().selectionner(null);
}

export function retirerSommet(pieceId: ID, index: number): void {
  const piece = pieceDuPlan(pieceId);
  if (!piece) return;
  if (piece.sommets.length <= 3) {
    notifier('Une pièce garde au moins 3 sommets');
    return;
  }
  const resultat = supprimerSommet(piece, index);
  const perdues = piece.ouvertures.length - resultat.ouvertures.length;
  modifierPiece(pieceId, () => resultat);
  useEtat.getState().selectionner({ type: 'piece', pieceId });
  if (perdues > 0) notifier(perdues > 1 ? `${perdues} ouvertures retirées` : 'Une ouverture retirée (elle ne tenait plus sur le mur)');
}

export function couperCote(pieceId: ID, index: number): void {
  const piece = pieceDuPlan(pieceId);
  if (!piece) return;
  const resultat = insererSommet(piece, index);
  if (resultat === piece) {
    notifier('Côté trop court pour être coupé');
    return;
  }
  modifierPiece(pieceId, () => resultat);
  useEtat.getState().selectionner({ type: 'sommet', pieceId, index: index + 1 });
}

export function ajouterOuvertureAuMilieu(pieceId: ID, index: number, type: TypeOuverture): void {
  const piece = pieceDuPlan(pieceId);
  if (!piece) return;
  const o = ouvertureSurCote(piece, type, index);
  modifierPiece(pieceId, (p) => {
    p.ouvertures.push(o);
  });
  useEtat.getState().selectionner({ type: 'ouverture', pieceId, ouvertureId: o.id });
}

export function dupliquer(pieceId: ID): void {
  const piece = pieceDuPlan(pieceId);
  if (!piece) return;
  const copie = dupliquerPiece(piece, { x: 50, y: 50 });
  useEtat.getState().modifierPlan((plan) => {
    plan.pieces.push(copie);
  });
  useEtat.getState().selectionner({ type: 'piece', pieceId: copie.id });
  notifier('Pièce dupliquée');
}

export function orthogonaliser(pieceId: ID): void {
  modifierPiece(pieceId, (p) => orthogonaliserPiece(p));
}

/** Supprime ce qui est sélectionné (touche Suppr au PC). */
export async function supprimerSelection(): Promise<void> {
  const { selection, selectionner, modifierPhoto } = useEtat.getState();
  if (!selection) return;
  switch (selection.type) {
    case 'piece':
      await supprimerPiece(selection.pieceId);
      break;
    case 'sommet':
      retirerSommet(selection.pieceId, selection.index);
      break;
    case 'ouverture':
      modifierPiece(selection.pieceId, (p) => {
        p.ouvertures = p.ouvertures.filter((o) => o.id !== selection.ouvertureId);
      });
      selectionner({ type: 'piece', pieceId: selection.pieceId });
      break;
    case 'equipement':
      modifierPiece(selection.pieceId, (p) => {
        p.equipements = p.equipements.filter((e) => e.id !== selection.equipementId);
      });
      selectionner({ type: 'piece', pieceId: selection.pieceId });
      break;
    case 'photo':
      await modifierPhoto(selection.photoId, { position: null });
      selectionner(null);
      break;
    case 'cote':
      break;
  }
}
