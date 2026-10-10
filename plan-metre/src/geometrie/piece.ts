// Géométrie propre aux pièces : murs, ouvertures, équipements.

import type { Catalogue, Equipement, ID, Ouverture, Piece, Point, TypeMur } from '../model/types';
import {
  aire,
  coinsRectangle,
  decalerVersExterieur,
  decouperParConvexe,
  longueurCote,
  suivant,
} from './polygone';

/** Type de mur du côté i : identifiant, ou null s'il n'y a pas de mur. */
export function typeMurIdCote(piece: Piece, i: number): ID | null {
  const t = piece.sommets[i]?.typeMurId;
  return t === undefined ? piece.typeMurDefautId : t;
}

export function trouverTypeMur(catalogue: Catalogue, id: ID | null): TypeMur | undefined {
  if (id === null) return undefined;
  return catalogue.typesMurs.find((t) => t.id === id);
}

/** Épaisseur du mur du côté i (cm) ; 0 sans mur ou si le type est inconnu. */
export function epaisseurCote(piece: Piece, i: number, catalogue: Catalogue): number {
  return trouverTypeMur(catalogue, typeMurIdCote(piece, i))?.epaisseur ?? 0;
}

/** Contour extérieur : contour intérieur décalé de l'épaisseur de chaque mur. */
export function contourExterieur(piece: Piece, catalogue: Catalogue): Point[] {
  const epaisseurs = piece.sommets.map((_, i) => epaisseurCote(piece, i, catalogue));
  return decalerVersExterieur(piece.sommets, epaisseurs);
}

export interface SegmentOuverture {
  /** Début et fin de l'ouverture, ramenés dans les limites du côté (cm le long du côté). */
  debut: number;
  fin: number;
  /** Extrémités dans le plan. */
  a: Point;
  b: Point;
  /** Longueur du côté porteur. */
  longueurCote: number;
}

/** Position réelle de l'ouverture sur son côté, ou null si le côté n'existe plus. */
export function segmentOuverture(piece: Piece, o: Ouverture): SegmentOuverture | null {
  const n = piece.sommets.length;
  if (o.cote < 0 || o.cote >= n) return null;
  const p = piece.sommets[o.cote];
  const q = suivant(piece.sommets, o.cote);
  const l = longueurCote(piece.sommets, o.cote);
  if (l <= 0) return null;
  const debut = Math.max(0, Math.min(o.position, l));
  const fin = Math.max(debut, Math.min(o.position + o.largeur, l));
  const ux = (q.x - p.x) / l;
  const uy = (q.y - p.y) / l;
  return {
    debut,
    fin,
    a: { x: p.x + ux * debut, y: p.y + uy * debut },
    b: { x: p.x + ux * fin, y: p.y + uy * fin },
    longueurCote: l,
  };
}

/** Largeur réellement disponible de l'ouverture sur son côté (cm). */
export function largeurEffective(piece: Piece, o: Ouverture): number {
  const s = segmentOuverture(piece, o);
  return s ? s.fin - s.debut : 0;
}

/** Hauteur d'ouverture réellement dans le mur : bornée par la hauteur sous plafond (cm). */
export function hauteurEffective(piece: Piece, o: Ouverture): number {
  const haut = Math.min(o.allege + o.hauteur, piece.hauteur);
  return Math.max(0, haut - Math.max(0, o.allege));
}

export function coinsEquipement(e: Equipement): Point[] {
  return coinsRectangle(e.x, e.y, e.largeur, e.profondeur, e.rotation);
}

/** Emprise de l'équipement à l'intérieur de la pièce (cm²). */
export function empriseDansPiece(piece: Piece, e: Equipement): number {
  return aire(decouperParConvexe(piece.sommets, coinsEquipement(e)));
}
