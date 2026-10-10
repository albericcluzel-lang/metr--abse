// Relevé en réalité augmentée : logique pure (sans WebXR), testable.
//
// Repère du monde WebXR : mètres, Y vertical vers le haut. Le plan est la vue
// de dessus : (x, z) du monde → (x·100, z·100) cm du plan (x à droite, y vers
// le bas), ce qui donne une vue non inversée.
//
// Déroulé d'une zone : on pose les angles au sol (étape « angles »), on ferme
// la pièce, on mesure ou saisit la hauteur (étape « hauteur »), puis on
// termine la zone (« zone-terminee ») et on peut en relever une autre dans la
// même session : toutes les zones partagent alors le même repère.

import type { Point } from '../../model/types';
import { aire } from '../../geometrie/polygone';
import { estPolygoneSimple } from './geometrieReleve';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Angle posé au sol ; `id` permet de le suivre (ancre WebXR) malgré les annulations. */
export interface AngleRA extends Point3 {
  id: number;
}

export type EtapeRA = 'angles' | 'hauteur' | 'zone-terminee';

export interface ZoneTermineeRA {
  /** Angles de la zone ; leurs ancres continuent de les corriger jusqu'à la fin de la session. */
  angles: AngleRA[];
  /** Altitude du sol de la zone (m, repère du monde). */
  sol: number;
  /** Hauteur sous plafond (cm). */
  hauteur: number;
  hauteurMesuree: boolean;
}

export interface EtatRA {
  etape: EtapeRA;
  /** Angles de la zone en cours. */
  angles: AngleRA[];
  /** Hauteur de la zone en cours (cm), null tant qu'elle n'est ni mesurée ni saisie. */
  hauteur: number | null;
  hauteurMesuree: boolean;
  /** Zones terminées dans cette session. */
  zones: ZoneTermineeRA[];
  /** Avertissement sur la dernière action refusée (null si tout va bien). */
  message: string | null;
  prochainId: number;
}

/** En deçà (m), viser le premier angle referme la pièce. */
export const SEUIL_FERMETURE_M = 0.15;
/** En deçà (m), un nouvel angle est considéré comme un double toucher. */
export const ECART_MIN_ANGLES_M = 0.05;
/** Surface minimale d'une pièce (m²). */
export const AIRE_MIN_M2 = 0.25;
export const HAUTEUR_MESURE_MIN_CM = 120;
export const HAUTEUR_MESURE_MAX_CM = 800;
export const HAUTEUR_SAISIE_MIN_CM = 50;
export const HAUTEUR_SAISIE_MAX_CM = 1000;
/** Portée maximale de la visée calculée sur le plan du sol (m). */
export const PORTEE_MAX_M = 15;
/** Écart d'altitude (m) toléré entre un point visé et le sol (sol inégal, imprécision du suivi). */
export const TOLERANCE_SOL_M = 0.08;
/** En deçà de cette hauteur (m) au-dessus du sol, un mur touché est visé à son pied. */
export const HAUTEUR_PIED_MUR_M = 0.5;

export function etatInitialRA(): EtatRA {
  return { etape: 'angles', angles: [], hauteur: null, hauteurMesuree: false, zones: [], message: null, prochainId: 1 };
}

export type ActionRA =
  | { type: 'placer-angle'; point: Point3 }
  | { type: 'annuler-angle' }
  | { type: 'fermer' }
  | { type: 'modifier-angles' }
  | { type: 'mesurer-hauteur'; point: Point3 }
  | { type: 'saisir-hauteur'; hauteur: number }
  | { type: 'terminer-zone' }
  | { type: 'nouvelle-zone' }
  | { type: 'ajuster-angles'; corrections: readonly { id: number; point: Point3 }[] }
  | { type: 'signaler'; message: string }
  | { type: 'effacer-message' }
  | { type: 'reinitialiser' };

export function distanceHorizontale(a: Point3, b: Point3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Vue de dessus en cm : (x, z) du monde → (x·100, z·100) du plan. */
export function versPlan(p: Point3): Point {
  return { x: p.x * 100, y: p.z * 100 };
}

export function anglesEnPlan(angles: readonly Point3[]): Point[] {
  return angles.map(versPlan);
}

/** Surface (m²) du contour formé par les angles. */
export function aireAnglesM2(angles: readonly Point3[]): number {
  return aire(anglesEnPlan(angles)) / 10000;
}

/** Altitude (m) des angles : médiane, qu'un angle douteux ne déplace pas ; null sans angle. */
export function altitudeAngles(angles: readonly Point3[]): number | null {
  if (angles.length === 0) return null;
  const y = angles.map((a) => a.y).sort((a, b) => a - b);
  const m = Math.floor(y.length / 2);
  return y.length % 2 ? y[m] : (y[m - 1] + y[m]) / 2;
}

/** Altitude du sol (m) : celle des angles en cours, sinon sol de la dernière zone. */
export function altitudeSol(etat: Pick<EtatRA, 'angles' | 'zones'>): number | null {
  if (etat.angles.length > 0) return altitudeAngles(etat.angles);
  const derniere = etat.zones[etat.zones.length - 1];
  return derniere ? derniere.sol : null;
}

/** Raison pour laquelle les angles ne forment pas une pièce valable, ou null. */
export function problemeFermeture(angles: readonly Point3[]): string | null {
  if (angles.length < 3) return 'Placez au moins 3 angles pour fermer la pièce.';
  if (!estPolygoneSimple(anglesEnPlan(angles))) return 'Les côtés se croisent : annulez le dernier angle.';
  if (aireAnglesM2(angles) < AIRE_MIN_M2) return 'La pièce est trop petite : vérifiez les angles.';
  return null;
}

function fermer(etat: EtatRA): EtatRA {
  const probleme = problemeFermeture(etat.angles);
  if (probleme) return { ...etat, message: probleme };
  return { ...etat, etape: 'hauteur', message: null };
}

export function reduireRA(etat: EtatRA, action: ActionRA): EtatRA {
  switch (action.type) {
    case 'placer-angle': {
      if (etat.etape !== 'angles') return etat;
      const p = action.point;
      if (![p.x, p.y, p.z].every(Number.isFinite)) return etat;
      const n = etat.angles.length;
      // Viser le premier angle referme la pièce.
      if (n >= 3 && distanceHorizontale(p, etat.angles[0]) < SEUIL_FERMETURE_M) return fermer(etat);
      if (n >= 1 && distanceHorizontale(p, etat.angles[n - 1]) < ECART_MIN_ANGLES_M) {
        return { ...etat, message: 'Angle trop proche du précédent : visez l’angle suivant.' };
      }
      // Dessus d'une pile de plaques, d'un établi… : pas au niveau du sol de la pièce.
      const ecart = n >= 1 ? p.y - altitudeAngles(etat.angles)! : 0;
      if (Math.abs(ecart) > TOLERANCE_SOL_M) {
        return {
          ...etat,
          message: `Point visé ${Math.round(Math.abs(ecart) * 100)} cm plus ${ecart > 0 ? 'haut' : 'bas'} que ${
            n > 1 ? 'les autres angles' : 'le premier angle'
          } : visez le sol au pied du mur.`,
        };
      }
      return {
        ...etat,
        angles: [...etat.angles, { id: etat.prochainId, x: p.x, y: p.y, z: p.z }],
        prochainId: etat.prochainId + 1,
        message: null,
      };
    }
    case 'annuler-angle':
      if (etat.etape !== 'angles' || etat.angles.length === 0) return etat;
      return { ...etat, angles: etat.angles.slice(0, -1), message: null };
    case 'fermer':
      if (etat.etape !== 'angles') return etat;
      return fermer(etat);
    case 'modifier-angles':
      if (etat.etape !== 'hauteur') return etat;
      return { ...etat, etape: 'angles', message: null };
    case 'mesurer-hauteur': {
      if (etat.etape !== 'hauteur') return etat;
      const h = hauteurVisee(etat, action.point);
      if (h === null) return etat;
      if (h < HAUTEUR_MESURE_MIN_CM || h > HAUTEUR_MESURE_MAX_CM) {
        return {
          ...etat,
          message: `Hauteur mesurée improbable (${h} cm) : visez la jonction mur / plafond, ou saisissez la hauteur.`,
        };
      }
      return { ...etat, hauteur: h, hauteurMesuree: true, message: null };
    }
    case 'saisir-hauteur': {
      if (etat.etape !== 'hauteur') return etat;
      const h = Math.round(action.hauteur);
      if (!Number.isFinite(h) || h < HAUTEUR_SAISIE_MIN_CM || h > HAUTEUR_SAISIE_MAX_CM) {
        return { ...etat, message: `Hauteur à saisir entre ${HAUTEUR_SAISIE_MIN_CM} et ${HAUTEUR_SAISIE_MAX_CM} cm.` };
      }
      return { ...etat, hauteur: h, hauteurMesuree: false, message: null };
    }
    case 'terminer-zone': {
      if (etat.etape !== 'hauteur') return etat;
      if (etat.hauteur === null) return { ...etat, message: 'Mesurez ou saisissez la hauteur sous plafond.' };
      const zone: ZoneTermineeRA = {
        angles: etat.angles,
        sol: altitudeSol(etat) ?? 0,
        hauteur: etat.hauteur,
        hauteurMesuree: etat.hauteurMesuree,
      };
      return {
        ...etat,
        etape: 'zone-terminee',
        angles: [],
        hauteur: null,
        hauteurMesuree: false,
        zones: [...etat.zones, zone],
        message: null,
      };
    }
    case 'nouvelle-zone':
      if (etat.etape !== 'zone-terminee') return etat;
      return { ...etat, etape: 'angles', message: null };
    case 'ajuster-angles': {
      // Corrections des ancres WebXR : le suivi a affiné la position d'angles
      // déjà posés, ceux de la zone en cours comme ceux des zones terminées
      // (toutes les zones de la session restent dans le même repère).
      const parId = new Map(action.corrections.map((c) => [c.id, c.point]));
      const ajuster = (angles: AngleRA[]): AngleRA[] => {
        let change = false;
        const r = angles.map((a) => {
          const p = parId.get(a.id);
          if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return a;
          change = true;
          return { id: a.id, x: p.x, y: p.y, z: p.z };
        });
        return change ? r : angles;
      };
      const angles = ajuster(etat.angles);
      let zonesChangees = false;
      const zones = etat.zones.map((z) => {
        const a = ajuster(z.angles);
        if (a === z.angles) return z;
        zonesChangees = true;
        return { ...z, angles: a, sol: altitudeAngles(a) ?? z.sol };
      });
      if (angles === etat.angles && !zonesChangees) return etat;
      return { ...etat, angles, zones: zonesChangees ? zones : etat.zones };
    }
    case 'signaler':
      return { ...etat, message: action.message };
    case 'effacer-message':
      return etat.message === null ? etat : { ...etat, message: null };
    case 'reinitialiser':
      return etatInitialRA();
  }
}

/** Hauteur (cm, arrondie) entre le sol de la zone et le point visé ; null sans sol connu. */
export function hauteurVisee(etat: Pick<EtatRA, 'angles' | 'zones'>, point: Point3): number | null {
  const sol = altitudeSol(etat);
  if (sol === null || !Number.isFinite(point.y)) return null;
  return Math.round((point.y - sol) * 100);
}

export interface InfosVisee {
  /** Distance horizontale depuis le dernier angle (cm), null sans angle ou sans visée. */
  distanceDernier: number | null;
  /** Le réticule est assez près du premier angle pour refermer la pièce. */
  procheDuPremier: boolean;
  /** La pièce peut être fermée (au moins 3 angles). */
  peutFermer: boolean;
  /** Hauteur visée (cm) à l'étape hauteur. */
  hauteur: number | null;
}

export function infosVisee(etat: EtatRA, visee: Point3 | null): InfosVisee {
  const n = etat.angles.length;
  const peutFermer = etat.etape === 'angles' && n >= 3;
  if (!visee) return { distanceDernier: null, procheDuPremier: false, peutFermer, hauteur: null };
  return {
    distanceDernier: etat.etape === 'angles' && n > 0 ? Math.round(distanceHorizontale(visee, etat.angles[n - 1]) * 100) : null,
    procheDuPremier: peutFermer && distanceHorizontale(visee, etat.angles[0]) < SEUIL_FERMETURE_M,
    peutFermer,
    hauteur: etat.etape === 'hauteur' ? hauteurVisee(etat, visee) : null,
  };
}

export interface BilanSession {
  zones: ZoneTermineeRA[];
  /** La zone en cours (au moins 3 angles valables) a été conservée. */
  zoneEnCoursConservee: boolean;
  /** Nombre d'angles perdus (zone en cours inutilisable). */
  anglesPerdus: number;
}

/**
 * Fin de session (volontaire ou interruption) : les zones terminées sont
 * gardées ; la zone en cours l'est aussi si ses angles forment une pièce,
 * avec la hauteur mesurée ou, à défaut, la hauteur par défaut.
 */
export function cloturerSession(etat: EtatRA, hauteurDefaut: number): BilanSession {
  const zones = [...etat.zones];
  if (etat.etape === 'zone-terminee' || etat.angles.length === 0) {
    return { zones, zoneEnCoursConservee: false, anglesPerdus: 0 };
  }
  if (problemeFermeture(etat.angles) !== null) {
    return { zones, zoneEnCoursConservee: false, anglesPerdus: etat.angles.length };
  }
  zones.push({
    angles: etat.angles,
    sol: altitudeSol(etat) ?? 0,
    hauteur: etat.hauteur ?? hauteurDefaut,
    hauteurMesuree: etat.hauteur !== null && etat.hauteurMesuree,
  });
  return { zones, zoneEnCoursConservee: true, anglesPerdus: 0 };
}

/**
 * Point où le rayon (origine, direction) rencontre le plan horizontal du sol
 * (y = ySol) ; null si le rayon ne descend pas ou si le point est trop loin.
 * Sert de repli quand le suivi ne trouve plus la surface du sol.
 */
export function intersectionRayonSol(origine: Point3, direction: Point3, ySol: number): Point3 | null {
  const l = Math.hypot(direction.x, direction.y, direction.z);
  if (l < 1e-9) return null;
  const d = { x: direction.x / l, y: direction.y / l, z: direction.z / l };
  if (d.y > -1e-3) return null;
  const t = (ySol - origine.y) / d.y;
  if (t <= 0 || t > PORTEE_MAX_M) return null;
  return { x: origine.x + d.x * t, y: ySol, z: origine.z + d.z * t };
}

/**
 * La pose d'un résultat de visée (matrice 4 × 4 en colonnes, axe Y = normale
 * de la surface) correspond-elle à une surface horizontale tournée vers le
 * haut (le sol) ?
 */
export function estSurfaceSol(matrice: ArrayLike<number>): boolean {
  return matrice[5] > 0.85;
}

/** La surface touchée est-elle verticale (un mur) ? */
export function estSurfaceVerticale(matrice: ArrayLike<number>): boolean {
  return Math.abs(matrice[5]) < 0.3;
}

/** Résultat de visée (hit-test) : position et pose de la surface touchée (matrice 4 × 4 en colonnes). */
export interface ResultatVisee {
  position: Point3;
  matrice: ArrayLike<number>;
}

export interface PointVise {
  point: Point3;
  /** Pose de la surface touchée (réticule posé à plat dessus), null pour un point calculé. */
  matrice: ArrayLike<number> | null;
  /** Point calculé sur le plan du sol faute de surface détectée. */
  estime: boolean;
}

/**
 * Point visé au sol, d'après les résultats de visée triés du plus proche au
 * plus loin le long du rayon (ordre donné par WebXR) :
 *  - une surface de sol est retenue, sauf si elle n'est pas au niveau des
 *    angles déjà posés (`niveauAngles`) : dessus d'une pile de plaques, d'un
 *    établi… ; elle est alors ignorée ;
 *  - un mur touché près du sol donne le point du sol à son pied ; touché plus
 *    haut, il masque tout ce qui est derrière lui (rien n'est retenu) ;
 *  - faute de surface, le rayon est prolongé jusqu'au plan du sol connu
 *    (point estimé).
 */
export function viseeSol(
  resultats: readonly ResultatVisee[],
  sol: number | null,
  rayon: { origine: Point3; direction: Point3 } | null,
  niveauAngles: number | null = null,
): PointVise | null {
  for (const r of resultats) {
    if (estSurfaceSol(r.matrice)) {
      if (niveauAngles !== null && Math.abs(r.position.y - niveauAngles) > TOLERANCE_SOL_M) continue;
      return { point: r.position, matrice: r.matrice, estime: false };
    }
    if (estSurfaceVerticale(r.matrice)) {
      const h = sol === null ? NaN : r.position.y - sol;
      if (sol !== null && h > -TOLERANCE_SOL_M && h < HAUTEUR_PIED_MUR_M) {
        return { point: { x: r.position.x, y: sol, z: r.position.z }, matrice: null, estime: false };
      }
      return null;
    }
    // Surface inclinée : ignorée.
  }
  if (sol === null || !rayon) return null;
  const point = intersectionRayonSol(rayon.origine, rayon.direction, sol);
  return point ? { point, matrice: null, estime: true } : null;
}

/** Placement d'un segment 3D posé au sol entre a et b (pavé allongé selon son axe x). */
export function poseSegment(a: Point3, b: Point3): { milieu: Point3; longueur: number; rotationY: number } {
  return {
    milieu: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 },
    longueur: distanceHorizontale(a, b),
    rotationY: -Math.atan2(b.z - a.z, b.x - a.x),
  };
}

/** Message en français pour une erreur de démarrage ou de déroulement de la session. */
export function messageErreurRA(erreur: unknown): string {
  const nom = typeof erreur === 'object' && erreur !== null && 'name' in erreur ? String(erreur.name) : '';
  const detail =
    typeof erreur === 'object' && erreur !== null && 'message' in erreur ? String(erreur.message) : String(erreur ?? '');
  switch (nom) {
    case 'NotAllowedError':
      return 'Accès à la caméra refusé. Autorisez la caméra pour ce site (Chrome → ⋮ → Paramètres → Paramètres des sites → Caméra), puis réessayez.';
    case 'NotSupportedError':
      return 'La réalité augmentée n’est pas disponible sur ce téléphone : ARCore n’est pas pris en charge ou les « Services Google Play pour la RA » ne sont pas installés ou à jour.';
    case 'SecurityError':
      return 'La réalité augmentée exige que l’appli soit ouverte en https et démarrée par un toucher sur l’écran.';
    case 'InvalidStateError':
      return 'Une session de réalité augmentée est déjà en cours. Fermez-la puis réessayez.';
    case 'HitTestIndisponible':
      return 'Ce téléphone ne permet pas de viser le sol en réalité augmentée (hit-test indisponible).';
    case 'WebGLIndisponible':
      return 'L’affichage 3D (WebGL) est indisponible sur ce navigateur.';
    default:
      return `Impossible de démarrer la réalité augmentée${detail ? ` : ${detail}` : ''}.`;
  }
}
