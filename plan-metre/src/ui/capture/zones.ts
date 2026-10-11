// Zones relevées (réalité augmentée, mètre laser, rectangle) et leur
// assemblage sur le plan : alignement, redressement des angles, placement en
// rangées compactes près des pièces existantes, création des pièces.
// Longueurs en cm.

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

/**
 * Zones d'une session de réalité augmentée (même repère, identifiant de
 * session commun). L'identifiant de chaque zone est stable : la même zone
 * convertie à nouveau (après une correction des ancres) remplace la première.
 */
export function zonesDepuisRA(zones: readonly ZoneTermineeRA[], sessionRA: string): ZoneRelevee[] {
  return zones.map((z) => ({
    id: `${sessionRA}-${z.id}`,
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
  /** Boîtes englobantes des pièces déjà présentes sur le plan cible (vide si le plan est vide). */
  existantes: readonly Boite[];
  /** Rapport largeur / hauteur visé pour l'ensemble (celui de l'écran du plan) ; 1 par défaut. */
  rapport?: number;
  marge?: number;
}

export interface ZonePlacee {
  zone: ZoneRelevee;
  /** Contour définitif dans le repère du plan (cm). */
  points: Point[];
}

function seChevauchent(a: Boite, b: Boite, marge: number): boolean {
  return a.minX < b.maxX + marge && b.minX < a.maxX + marge && a.minY < b.maxY + marge && b.minY < a.maxY + marge;
}

/**
 * Emplacement libre le plus haut, puis le plus à gauche, pour une boîte
 * l × h : à `marge` au moins de toutes les boîtes occupées, sans dépasser la
 * largeur de rangée visée. Les positions essayées sont l'origine et les bords
 * droit et bas (marge comprise) des boîtes occupées.
 */
function emplacementLibre(l: number, h: number, occupees: readonly Boite[], origine: Point, largeurRangee: number, marge: number): Point {
  const xs = [origine.x, ...occupees.map((b) => b.maxX + marge)].filter((x) => x >= origine.x).sort((a, b) => a - b);
  const ys = [origine.y, ...occupees.map((b) => b.maxY + marge)].filter((y) => y >= origine.y).sort((a, b) => a - b);
  for (const y of ys) {
    for (const x of xs) {
      if (x > origine.x && x + l > origine.x + largeurRangee) break;
      const boite = { minX: x, minY: y, maxX: x + l, maxY: y + h };
      if (!occupees.some((b) => seChevauchent(boite, b, marge))) return { x, y };
    }
  }
  // Toujours libre : sous toutes les boîtes, au début de la rangée.
  return { x: origine.x, y: ys[ys.length - 1] };
}

const largeur = (b: Boite) => b.maxX - b.minX;
const hauteur = (b: Boite) => b.maxY - b.minY;

function englobante(boites: readonly Boite[]): Boite {
  return boiteEnglobante(boites.flatMap((b) => [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]));
}

/** Pose les boîtes l'une après l'autre dans les places libres, en rangées de la largeur donnée. */
function disposer(tailles: readonly Boite[], existantes: readonly Boite[], origine: Point, largeurRangee: number, marge: number): Boite[] {
  const occupees = [...existantes];
  return tailles.map((t) => {
    const p = emplacementLibre(largeur(t), hauteur(t), occupees, origine, largeurRangee, marge);
    const b = { minX: p.x, minY: p.y, maxX: p.x + largeur(t), maxY: p.y + hauteur(t) };
    occupees.push(b);
    return b;
  });
}

/**
 * Pose les zones sur le plan :
 *  - les zones d'une même session de réalité augmentée gardent leurs
 *    positions relatives ; le groupe tourne pour aligner le plus long côté
 *    de sa première zone sur l'axe x ;
 *  - les groupes (session de réalité augmentée, ou zone seule) sont rangés
 *    en rangées à partir du coin haut gauche des pièces existantes (ou de
 *    l'origine), dans les places libres, à `marge` les uns des autres et des
 *    pièces existantes ;
 *  - la largeur des rangées est choisie pour que l'ensemble, existant
 *    compris, tienne le plus grand possible dans un écran du rapport visé :
 *    avec beaucoup de pièces, le plan reste lisible sans zoomer, y compris
 *    quand on les ajoute une à une.
 * Le résultat suit l'ordre des zones reçues.
 */
export function placerZones(zones: readonly ZoneRelevee[], options: OptionsPlacement): ZonePlacee[] {
  const marge = options.marge ?? MARGE_PLACEMENT_CM;
  const rapport = options.rapport ?? 1;
  const groupes = grouperZones(zones).flatMap((groupe) => {
    const rotation = groupe[0].methode === 'ra' ? angleAlignement(groupe[0].points) : 0;
    const contours = groupe.map((z) =>
      preparerContour(
        z.points.map((p) => tourner(p, rotation)),
        options.redresser,
      ),
    );
    const tous = contours.flat();
    return tous.length > 0 ? [{ groupe, contours, boite: boiteEnglobante(tous) }] : [];
  });
  if (groupes.length === 0) return [];

  const existantes = options.existantes;
  const existant = existantes.length > 0 ? englobante(existantes) : null;
  const origine = existant ? { x: existant.minX, y: existant.minY } : { x: 0, y: 0 };
  const tailles = groupes.map((g) => g.boite);
  // Largeurs de rangée essayées : la plus étroite (l'existant, ou le plus
  // large groupe), puis élargie d'un groupe à la fois, jusqu'au double de la
  // largeur d'un rectangle du rapport visé de même surface (marges comprises).
  const surface = [...existantes, ...tailles].reduce((s, b) => s + (largeur(b) + marge) * (hauteur(b) + marge), 0);
  let l = Math.max(existant ? largeur(existant) : 0, ...tailles.map(largeur));
  const largeurs = [l];
  for (const t of tailles) {
    l += largeur(t) + marge;
    if (l > 2 * Math.sqrt(surface * rapport)) break;
    largeurs.push(l);
  }
  // Retenue : celle qui s'affiche le plus grand dans un écran du rapport visé
  // (à égalité, la moins étendue).
  let meilleure: { poses: Boite[]; cote: number; aire: number } | null = null;
  for (const largeurRangee of largeurs) {
    const poses = disposer(tailles, existantes, origine, largeurRangee, marge);
    const tout = englobante([...existantes, ...poses]);
    const cote = Math.max(largeur(tout) / rapport, hauteur(tout));
    const aire = largeur(tout) * hauteur(tout);
    if (!meilleure || cote < meilleure.cote - 1e-6 || (cote < meilleure.cote + 1e-6 && aire < meilleure.aire - 1e-6)) {
      meilleure = { poses, cote, aire };
    }
  }
  const poses = meilleure!.poses;

  const resultat = new Map<string, Point[]>();
  groupes.forEach(({ groupe, contours, boite: b }, k) => {
    const dx = poses[k].minX - b.minX;
    const dy = poses[k].minY - b.minY;
    groupe.forEach((z, i) => {
      resultat.set(
        z.id,
        contours[i].map((p) => ({ x: arrondirCm(p.x + dx), y: arrondirCm(p.y + dy) })),
      );
    });
  });
  return zones.filter((z) => resultat.has(z.id)).map((z) => ({ zone: z, points: resultat.get(z.id)! }));
}

/** Boîtes englobantes de chaque pièce (contours extérieurs, murs compris). */
export function boitesDesPieces(pieces: readonly Piece[], catalogue: Catalogue): Boite[] {
  return pieces.filter((p) => p.sommets.length >= 3).map((p) => boiteEnglobante(contourExterieur(p, catalogue)));
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
