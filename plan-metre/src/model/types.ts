// Modèle de données de l'appli.
//
// Unités : toutes les longueurs sont en centimètres (cm). Les surfaces et
// volumes sont convertis en m² / m³ uniquement au moment du métré.
//
// Repère du plan : x vers la droite, y vers le bas (comme l'écran / SVG).
// En 3D, le point (x, y) du plan devient (x, 0, y) en mètres, l'axe vertical
// étant Y.

export type ID = string;

export interface Point {
  x: number;
  y: number;
}

/**
 * Sommet du contour intérieur d'une pièce.
 * Le mur porté par le côté « ce sommet → sommet suivant » est décrit par
 * `typeMurId` :
 *  - absent (undefined) : type de mur par défaut de la pièce ;
 *  - null : pas de mur (séparation fictive, ex. cuisine ouverte sur séjour) ;
 *  - un identifiant : type de mur du catalogue du chantier.
 */
export interface Sommet extends Point {
  typeMurId?: ID | null;
}

export type TypeOuverture = 'porte' | 'porte-fenetre' | 'fenetre' | 'baie' | 'passage';

/** Ouverture (menuiserie ou passage) posée sur un côté de pièce. */
export interface Ouverture {
  id: ID;
  type: TypeOuverture;
  /** Index du côté porteur : côté sommets[cote] → sommets[cote + 1]. */
  cote: number;
  /** Distance (cm) entre le début du côté et le bord de l'ouverture. */
  position: number;
  largeur: number;
  hauteur: number;
  /** Hauteur d'allège (cm) ; 0 pour une porte. */
  allege: number;
  /** Sens d'ouverture pour le dessin (porte) : charnière au début ou à la fin du tableau. */
  charniere?: 'debut' | 'fin';
  /** Ouvre vers l'intérieur de la pièce (dessin uniquement). */
  versInterieur?: boolean;
}

export type TypeEquipement =
  | 'baignoire'
  | 'douche'
  | 'meuble-vasque'
  | 'lavabo'
  | 'wc'
  | 'evier'
  | 'meuble-cuisine'
  | 'placard'
  | 'radiateur'
  | 'ballon-ecs'
  | 'autre';

/** Équipement / mobilier fixe posé au sol (rectangle). */
export interface Equipement {
  id: ID;
  type: TypeEquipement;
  nom: string;
  /** Centre du rectangle (cm, repère du plan). */
  x: number;
  y: number;
  largeur: number;
  profondeur: number;
  hauteur: number;
  /** Rotation en degrés (sens horaire à l'écran). */
  rotation: number;
  /** L'emprise est déduite du revêtement de sol. */
  deduireSol: boolean;
}

export interface Piece {
  id: ID;
  nom: string;
  /** Contour intérieur (au nu des murs), au moins 3 sommets. */
  sommets: Sommet[];
  /** Hauteur sous plafond (cm). */
  hauteur: number;
  /** Type de mur appliqué aux côtés sans type explicite. */
  typeMurDefautId: ID;
  /** Revêtement de sol (catalogue), null si non renseigné. */
  revetementSolId: ID | null;
  /** Le plafond est compté dans les surfaces à peindre. */
  plafondAPeindre: boolean;
  ouvertures: Ouverture[];
  equipements: Equipement[];
}

export interface Plan {
  pieces: Piece[];
}

export type Variante = 'actuel' | 'renove';

export interface Niveau {
  id: ID;
  nom: string;
  /** Ordre d'affichage (0 = le plus bas). */
  ordre: number;
  /** Hauteur sous plafond proposée pour les nouvelles pièces (cm). */
  hauteurDefaut: number;
  actuel: Plan;
  /** Plan du projet de rénovation ; null tant qu'il n'a pas été créé. */
  renove: Plan | null;
}

export interface TypeMur {
  id: ID;
  nom: string;
  /** Épaisseur (cm), utilisée pour le périmètre extérieur et le dessin. */
  epaisseur: number;
}

export interface RevetementSol {
  id: ID;
  nom: string;
  /** Couleur d'affichage (plan 2D et 3D), format #rrggbb. */
  couleur: string;
}

export interface Catalogue {
  typesMurs: TypeMur[];
  revetementsSol: RevetementSol[];
}

export interface ParametresMetre {
  /** Déduire les ouvertures des surfaces à peindre (« hors ouvrants »). */
  deduireOuvertures: boolean;
  /**
   * Les ouvertures de surface inférieure ou égale à ce seuil (m²) ne sont pas
   * déduites. 0 = toutes les ouvertures sont déduites.
   */
  seuilDeductionOuverture: number;
}

export interface Projet {
  id: ID;
  nom: string;
  client: string;
  adresse: string;
  notes: string;
  /** Dates ISO 8601. */
  creeLe: string;
  modifieLe: string;
  niveaux: Niveau[];
  catalogue: Catalogue;
  parametres: ParametresMetre;
  /** Version du format, pour les migrations futures. */
  version: 1;
}

/** Métadonnées d'une photo (l'image elle-même est stockée à part). */
export interface Photo {
  id: ID;
  projetId: ID;
  niveauId: ID | null;
  pieceId: ID | null;
  /** Position de l'épingle sur le plan (cm), null si non placée. */
  position: Point | null;
  legende: string;
  /** Date de prise de vue / d'import, ISO 8601. */
  date: string;
  largeur: number;
  hauteur: number;
}

/** Ce qui est sélectionné dans l'éditeur de plan. */
export type Selection =
  | { type: 'piece'; pieceId: ID }
  | { type: 'sommet'; pieceId: ID; index: number }
  | { type: 'cote'; pieceId: ID; index: number }
  | { type: 'ouverture'; pieceId: ID; ouvertureId: ID }
  | { type: 'equipement'; pieceId: ID; equipementId: ID }
  | { type: 'photo'; photoId: ID };
