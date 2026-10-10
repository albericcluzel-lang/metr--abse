// Zones relevées (réalité augmentée, mètre laser, rectangle) et leur
// assemblage sur le plan : alignement, redressement des angles, placement à
// côté des pièces existantes, création des pièces. Longueurs en cm.

import { nouvelId, nouvellePiece } from '../../model/fabrique';
import type { Catalogue, ID, Piece, Point } from '../../model/types';
import { contourExterieur } from '../../geometrie/piece';
import {
  aireSignee,
  boiteEnglobante,
  centroide,
  distance,
  orientationDominante,
  orthogonaliser,
  suivant,
  tourner,
} from '../../geometrie/polygone';
import { retirerAnglesPlats } from './geometrieReleve';
import { anglesEnPlan, type ZoneTermineeRA } from './releveRA';

export type MethodeReleve = 'ra' | 'laser' | 'rectangle';

export const LIBELLES_METHODES: Record<MethodeReleve, string> = {
  ra: 'Réalité augmentée',
  laser: 'Mètre laser',
  rectangle: 'Pièce rectangulaire',
};

export interface ZoneRelevee {
  id: string;
  methode: MethodeReleve;
  /** Nom saisi (peut rester vide jusqu'à la finalisation). */
  nom: string;
  /**
   * Contour intérieur (cm). Réalité augmentée : repère de la session ;
   * mètre laser et rectangle : repère propre à la zone.
   */
  points: Point[];
  /** Hauteur sous plafond (cm). */
  hauteur: number;
  /** Les zones d'une même session de réalité augmentée partagent le même repère. */
  sessionRA?: string;
}

/** Écart (cm) entre les pièces existantes et les zones posées, et entre groupes de zones. */
export const MARGE_PLACEMENT_CM = 100;
/** Les angles à moins de ce nombre de degrés d'un angle droit (ou plat) sont redressés. */
export const TOLERANCE_REDRESSEMENT_DEG = 8;

export interface Boite {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function zoneRectangle(nom: string, longueur: number, largeur: number, hauteur: number): ZoneRelevee {
  return {
    id: nouvelId(),
    methode: 'rectangle',
    nom: nom.trim(),
    points: [
      { x: 0, y: 0 },
      { x: longueur, y: 0 },
      { x: longueur, y: largeur },
      { x: 0, y: largeur },
    ],
    hauteur,
  };
}

export function zoneLaser(points: readonly Point[], hauteur: number, nom = ''): ZoneRelevee {
  return { id: nouvelId(), methode: 'laser', nom, points: points.map((p) => ({ x: p.x, y: p.y })), hauteur };
}

/** Zones d'une session de réalité augmentée (même repère, identifiant de session commun). */
export function zonesDepuisRA(zones: readonly ZoneTermineeRA[], sessionRA: string): ZoneRelevee[] {
  return zones.map((z) => ({
    id: nouvelId(),
    methode: 'ra',
    nom: '',
    points: anglesEnPlan(z.angles),
    hauteur: z.hauteur,
    sessionRA,
  }));
}

/** Groupes à placer d'un bloc : une session de réalité augmentée, ou une zone seule. */
export function grouperZones(zones: readonly ZoneRelevee[]): ZoneRelevee[][] {
  const groupes: ZoneRelevee[][] = [];
  const parSession = new Map<string, ZoneRelevee[]>();
  for (const z of zones) {
    if (z.methode === 'ra' && z.sessionRA) {
      const g = parSession.get(z.sessionRA);
      if (g) {
        g.push(z);
        continue;
      }
      const nouveau = [z];
      parSession.set(z.sessionRA, nouveau);
      groupes.push(nouveau);
    } else {
      groupes.push([z]);
    }
  }
  return groupes;
}

/**
 * Rotation (radians) qui aligne le plus long côté du contour sur l'axe x,
 * choisie la plus petite possible (le côté peut finir orienté vers la droite
 * ou vers la gauche) pour garder le sens de lecture du relevé.
 */
export function angleAlignement(points: readonly Point[]): number {
  let meilleur = -1;
  let angle = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = suivant(points, i);
    const l = distance(a, b);
    if (l > meilleur + 1e-9) {
      meilleur = l;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  // Rotation −angle ramenée dans ]−π/2, π/2].
  let r = -angle;
  while (r > Math.PI / 2) r -= Math.PI;
  while (r <= -Math.PI / 2) r += Math.PI;
  return r;
}

function arrondirCm(v: number): number {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? 0 : r;
}

/**
 * Prépare le contour d'une zone : redressement éventuel des angles proches de
 * 90°, puis sens horaire à l'écran (convention du plan) et arrondi au mm.
 */
export function preparerContour(points: readonly Point[], redresser: boolean): Point[] {
  let pts = points.map((p) => ({ x: p.x, y: p.y }));
  if (redresser && pts.length >= 3) {
    pts = retirerAnglesPlats(pts, TOLERANCE_REDRESSEMENT_DEG);
    pts = orthogonaliser(pts, TOLERANCE_REDRESSEMENT_DEG);
    // Les côtés redressés suivent l'orientation propre de la zone : on la
    // ramène exactement sur les axes du plan (petite rotation sur place).
    const base = orientationDominante(pts);
    if (Math.abs(base) > 1e-9 && Math.abs(base) <= (TOLERANCE_REDRESSEMENT_DEG * Math.PI) / 180) {
      const c = centroide(pts);
      pts = pts.map((p) => tourner(p, -base, c));
    }
  }
  if (aireSignee(pts) < 0) pts.reverse();
  return pts.map((p) => ({ x: arrondirCm(p.x), y: arrondirCm(p.y) }));
}

export interface OptionsPlacement {
  /** Redresser les angles proches de 90°. */
  redresser: boolean;
  /** Boîte englobante des pièces déjà présentes sur le plan cible (null si le plan est vide). */
  existant: Boite | null;
  marge?: number;
}

export interface ZonePlacee {
  zone: ZoneRelevee;
  /** Contour définitif dans le repère du plan (cm). */
  points: Point[];
}

/**
 * Pose les zones sur le plan :
 *  - les zones d'une même session de réalité augmentée gardent leurs
 *    positions relatives ; le groupe tourne pour aligner le plus long côté
 *    de sa première zone sur l'axe x ;
 *  - les zones laser / rectangle sont posées côte à côte ;
 *  - le premier groupe se place à droite des pièces existantes (marge),
 *    aligné sur leur haut, ou à l'origine si le plan est vide.
 * Le résultat suit l'ordre des zones reçues.
 */
export function placerZones(zones: readonly ZoneRelevee[], options: OptionsPlacement): ZonePlacee[] {
  const marge = options.marge ?? MARGE_PLACEMENT_CM;
  const resultat = new Map<string, Point[]>();
  let curseurX = options.existant ? options.existant.maxX + marge : 0;
  const haut = options.existant ? options.existant.minY : 0;
  for (const groupe of grouperZones(zones)) {
    const rotation = groupe[0].methode === 'ra' ? angleAlignement(groupe[0].points) : 0;
    const contours = groupe.map((z) =>
      preparerContour(
        z.points.map((p) => tourner(p, rotation)),
        options.redresser,
      ),
    );
    const tous = contours.flat();
    if (tous.length === 0) continue;
    const b = boiteEnglobante(tous);
    const dx = curseurX - b.minX;
    const dy = haut - b.minY;
    groupe.forEach((z, i) => {
      resultat.set(
        z.id,
        contours[i].map((p) => ({ x: arrondirCm(p.x + dx), y: arrondirCm(p.y + dy) })),
      );
    });
    curseurX += b.maxX - b.minX + marge;
  }
  return zones.filter((z) => resultat.has(z.id)).map((z) => ({ zone: z, points: resultat.get(z.id)! }));
}

/** Boîte englobante des pièces (contours extérieurs, murs compris), null s'il n'y en a pas. */
export function boiteDesPieces(pieces: readonly Piece[], catalogue: Catalogue): Boite | null {
  const points = pieces.filter((p) => p.sommets.length >= 3).flatMap((p) => contourExterieur(p, catalogue));
  return points.length > 0 ? boiteEnglobante(points) : null;
}

/** « Pièce 1 », « Pièce 2 »… en évitant les noms déjà pris. */
export function nomsParDefaut(nombre: number, nomsPris: readonly string[]): string[] {
  const pris = new Set(nomsPris.map((n) => n.trim().toLowerCase()));
  const noms: string[] = [];
  let k = 1;
  while (noms.length < nombre) {
    const nom = `Pièce ${k++}`;
    if (!pris.has(nom.toLowerCase())) noms.push(nom);
  }
  return noms;
}

export interface ReglagesPieces {
  /** Nom et hauteur par zone (identifiant de zone). */
  noms: Record<string, string>;
  hauteurs: Record<string, number>;
  typeMurDefautId: ID;
}

/** Pièces du modèle correspondant aux zones placées. */
export function construirePieces(placees: readonly ZonePlacee[], reglages: ReglagesPieces): Piece[] {
  return placees.map(({ zone, points }, i) =>
    nouvellePiece((reglages.noms[zone.id] ?? zone.nom).trim() || `Pièce ${i + 1}`, points, {
      hauteur: reglages.hauteurs[zone.id] ?? zone.hauteur,
      typeMurDefautId: reglages.typeMurDefautId,
    }),
  );
}

// ─── Brouillon (protège le relevé si Android recharge la page) ──────────

const VERSION_BROUILLON = 1;

export function serialiserBrouillon(zones: readonly ZoneRelevee[]): string {
  return JSON.stringify({ version: VERSION_BROUILLON, zones });
}

function estPoint(p: unknown): p is Point {
  return (
    typeof p === 'object' &&
    p !== null &&
    Number.isFinite((p as Point).x) &&
    Number.isFinite((p as Point).y)
  );
}

/** Relit un brouillon ; les zones mal formées sont ignorées. */
export function lireBrouillon(texte: string | null): ZoneRelevee[] {
  if (!texte) return [];
  let donnees: unknown;
  try {
    donnees = JSON.parse(texte);
  } catch {
    return [];
  }
  if (typeof donnees !== 'object' || donnees === null) return [];
  const { version, zones } = donnees as { version?: unknown; zones?: unknown };
  if (version !== VERSION_BROUILLON || !Array.isArray(zones)) return [];
  return zones.flatMap((z): ZoneRelevee[] => {
    if (typeof z !== 'object' || z === null) return [];
    const { id, methode, nom, points, hauteur, sessionRA } = z as Record<string, unknown>;
    if (typeof id !== 'string' || !(methode === 'ra' || methode === 'laser' || methode === 'rectangle')) return [];
    if (!Array.isArray(points) || points.length < 3 || !points.every(estPoint)) return [];
    if (typeof hauteur !== 'number' || !Number.isFinite(hauteur) || hauteur <= 0) return [];
    return [
      {
        id,
        methode,
        nom: typeof nom === 'string' ? nom : '',
        points: points.map((p) => ({ x: p.x, y: p.y })),
        hauteur,
        ...(typeof sessionRA === 'string' ? { sessionRA } : {}),
      },
    ];
  });
}
