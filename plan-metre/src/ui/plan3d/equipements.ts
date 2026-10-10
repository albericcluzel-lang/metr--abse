// Volumes 3D des équipements (baignoire, receveur, vasque, WC…).
//
// Chaque équipement est un rectangle largeur × profondeur centré en (x, y),
// tourné de `rotation` (sens horaire à l'écran), haut de `hauteur`. Les formes
// restent simples ; le dos de l'équipement (réservoir du WC) est le côté
// −profondeur / 2 du repère local, c'est-à-dire le haut du rectangle quand la
// rotation est nulle.
//
// Le volume est construit directement dans le repère du plan avec `tourner`,
// comme `coinsEquipement` : l'emprise 3D coïncide exactement avec le plan 2D.

import { tourner } from '../../geometrie/polygone';
import type { Equipement, Point } from '../../model/types';
import { Tampon, VERS_LE_HAUT } from './tampon';

/** Points d'une ellipse (repère local de l'équipement). */
function ellipse(cx: number, cy: number, rx: number, ry: number, segments = 24): Point[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * 2 * Math.PI;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}

/** Rectangle aux angles arrondis (repère local). */
function rectangleArrondi(x0: number, y0: number, x1: number, y1: number, rayon: number, pas = 4): Point[] {
  const r = Math.max(0, Math.min(rayon, (x1 - x0) / 2, (y1 - y0) / 2));
  if (r < 0.5) return rectangle(x0, y0, x1, y1);
  const coins = [
    { cx: x1 - r, cy: y0 + r, a0: -Math.PI / 2 },
    { cx: x1 - r, cy: y1 - r, a0: 0 },
    { cx: x0 + r, cy: y1 - r, a0: Math.PI / 2 },
    { cx: x0 + r, cy: y0 + r, a0: Math.PI },
  ];
  const pts: Point[] = [];
  for (const c of coins) {
    for (let i = 0; i <= pas; i++) {
      const a = c.a0 + (i / pas) * (Math.PI / 2);
      pts.push({ x: c.cx + r * Math.cos(a), y: c.cy + r * Math.sin(a) });
    }
  }
  return pts;
}

function rectangle(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Hauteur de la face « détail » posée sur un dessus (évite le scintillement). */
const DECOLLEMENT = 0.15;

/**
 * Remplit `corps` (matière blanche) et `detail` (vasques, plans de travail,
 * fond de baignoire, en gris clair) avec le volume de l'équipement.
 */
export function construireVolumeEquipement(e: Equipement, corps: Tampon, detail: Tampon): void {
  const angle = (e.rotation * Math.PI) / 180;
  const versPlan = (p: Point): Point => {
    const q = tourner(p, angle);
    return { x: q.x + e.x, y: q.y + e.y };
  };
  const placer = (pts: readonly Point[]) => pts.map(versPlan);
  const L = Math.max(e.largeur, 1);
  const P = Math.max(e.profondeur, 1);
  const H = Math.max(e.hauteur, 1);
  const hl = L / 2;
  const hp = P / 2;
  const emprise = placer(rectangle(-hl, -hp, hl, hp));

  switch (e.type) {
    case 'baignoire': {
      // Cuve creusée : socle jusqu'au fond, rebord tout autour.
      const rebord = Math.max(4, Math.min(10, Math.min(L, P) * 0.12));
      const profondeur = Math.min(H * 0.75, 42);
      const fond = H - profondeur;
      const cuve = placer(rectangleArrondi(-hl + rebord, -hp + rebord, hl - rebord, hp - rebord, Math.min(L, P) * 0.2));
      corps.prisme(emprise, 0, fond, { dessus: false });
      corps.prisme(emprise, fond, H, { trous: [cuve] });
      detail.faceHorizontale(cuve, [], fond, VERS_LE_HAUT);
      break;
    }
    case 'douche': {
      corps.prisme(emprise, 0, H);
      detail.faceHorizontale(placer(ellipse(0, 0, Math.min(5, hl / 3), Math.min(5, hp / 3), 16)), [], H + DECOLLEMENT, VERS_LE_HAUT);
      break;
    }
    case 'meuble-vasque':
    case 'lavabo': {
      // Le lavabo est suspendu : seule la vasque (18 cm) est sous la hauteur indiquée.
      const bas = e.type === 'lavabo' ? Math.max(0, H - 18) : 0;
      corps.prisme(emprise, bas, H, { dessous: bas > 0 });
      const vasque = ellipse(0, hp * 0.08, Math.min(hl * 0.62, 26), Math.min(hp * 0.6, 18));
      detail.faceHorizontale(placer(vasque), [], H + DECOLLEMENT, VERS_LE_HAUT);
      break;
    }
    case 'wc': {
      // Réservoir au dos, cuvette ovale devant.
      const reservoir = Math.min(18, P * 0.35);
      const hCuvette = Math.min(40, H);
      corps.prisme(placer(rectangle(-hl, -hp, hl, -hp + reservoir)), 0, H);
      const cy = reservoir / 2;
      const ry = (P - reservoir) / 2;
      corps.prisme(placer(ellipse(0, cy, hl * 0.92, ry)), 0, hCuvette);
      detail.faceHorizontale(placer(ellipse(0, cy + ry * 0.1, hl * 0.55, ry * 0.6, 20)), [], hCuvette + DECOLLEMENT, VERS_LE_HAUT);
      break;
    }
    case 'evier':
    case 'meuble-cuisine': {
      // Caisson blanc, plan de travail gris clair.
      const plan = Math.min(4, H / 4);
      corps.prisme(emprise, 0, H - plan);
      detail.prisme(emprise, H - plan, H);
      if (e.type === 'evier') {
        const bac = rectangleArrondi(-Math.min(hl * 0.8, 25), -hp * 0.6, Math.min(hl * 0.8, 25) * 0.2, hp * 0.6, 4);
        corps.faceHorizontale(placer(bac), [], H + DECOLLEMENT, VERS_LE_HAUT);
      }
      break;
    }
    case 'ballon-ecs': {
      corps.prisme(placer(ellipse(0, 0, Math.min(hl, hp), Math.min(hl, hp), 28)), 0, H);
      break;
    }
    default:
      corps.prisme(emprise, 0, H);
  }
}
