import {
  catalogueParDefaut,
  MODELES_EQUIPEMENTS,
  MODELES_OUVERTURES,
  parametresParDefaut,
  TYPE_MUR_DEFAUT_ID,
} from './catalogue';
import type {
  Equipement,
  ID,
  Niveau,
  Ouverture,
  Piece,
  Plan,
  Point,
  Projet,
  TypeEquipement,
  TypeOuverture,
} from './types';

export function nouvelId(): ID {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function maintenantIso(): string {
  return new Date().toISOString();
}

export function planVide(): Plan {
  return { pieces: [] };
}

export function nouveauNiveau(nom: string, ordre: number, hauteurDefaut = 250): Niveau {
  return { id: nouvelId(), nom, ordre, hauteurDefaut, actuel: planVide(), renove: null };
}

export function nouveauProjet(infos: { nom: string; client?: string; adresse?: string }): Projet {
  const date = maintenantIso();
  return {
    id: nouvelId(),
    nom: infos.nom.trim() || 'Nouveau chantier',
    client: infos.client?.trim() ?? '',
    adresse: infos.adresse?.trim() ?? '',
    notes: '',
    creeLe: date,
    modifieLe: date,
    niveaux: [nouveauNiveau('RDC', 0)],
    catalogue: catalogueParDefaut(),
    parametres: parametresParDefaut(),
    version: 1,
  };
}

export function nouvellePiece(
  nom: string,
  points: Point[],
  options: { hauteur?: number; typeMurDefautId?: ID } = {},
): Piece {
  return {
    id: nouvelId(),
    nom,
    sommets: points.map((p) => ({ x: p.x, y: p.y })),
    hauteur: options.hauteur ?? 250,
    typeMurDefautId: options.typeMurDefautId ?? TYPE_MUR_DEFAUT_ID,
    revetementSolId: null,
    plafondAPeindre: true,
    ouvertures: [],
    equipements: [],
  };
}

/** Pièce rectangulaire dont le coin haut-gauche intérieur est en `origine`. */
export function pieceRectangle(
  nom: string,
  longueur: number,
  largeur: number,
  options: { hauteur?: number; typeMurDefautId?: ID; origine?: Point } = {},
): Piece {
  const o = options.origine ?? { x: 0, y: 0 };
  return nouvellePiece(
    nom,
    [
      { x: o.x, y: o.y },
      { x: o.x + longueur, y: o.y },
      { x: o.x + longueur, y: o.y + largeur },
      { x: o.x, y: o.y + largeur },
    ],
    options,
  );
}

export function nouvelleOuverture(
  type: TypeOuverture,
  cote: number,
  position: number,
  dims: Partial<Pick<Ouverture, 'largeur' | 'hauteur' | 'allege'>> = {},
): Ouverture {
  const m = MODELES_OUVERTURES[type];
  return {
    id: nouvelId(),
    type,
    cote,
    position,
    largeur: dims.largeur ?? m.largeur,
    hauteur: dims.hauteur ?? m.hauteur,
    allege: dims.allege ?? m.allege,
    charniere: 'debut',
    versInterieur: true,
  };
}

export function nouvelEquipement(type: TypeEquipement, centre: Point): Equipement {
  const m = MODELES_EQUIPEMENTS[type];
  return {
    id: nouvelId(),
    type,
    nom: m.libelle,
    x: centre.x,
    y: centre.y,
    largeur: m.largeur,
    profondeur: m.profondeur,
    hauteur: m.hauteur,
    rotation: 0,
    deduireSol: m.deduireSol,
  };
}

/**
 * Point de départ du plan rénové : copie profonde du plan actuel qui garde
 * les mêmes identifiants, pour pouvoir comparer pièce à pièce et garder le
 * lien avec les photos.
 */
export function copierPlanPourRenovation(plan: Plan): Plan {
  return structuredClone(plan);
}

/** Copie d'une pièce avec de nouveaux identifiants (copier-coller dans un plan). */
export function dupliquerPiece(p: Piece, decalage: Point = { x: 0, y: 0 }): Piece {
  return {
    ...p,
    id: nouvelId(),
    sommets: p.sommets.map((s) => ({ ...s, x: s.x + decalage.x, y: s.y + decalage.y })),
    ouvertures: p.ouvertures.map((o) => ({ ...o, id: nouvelId() })),
    equipements: p.equipements.map((e) => ({
      ...e,
      id: nouvelId(),
      x: e.x + decalage.x,
      y: e.y + decalage.y,
    })),
  };
}
