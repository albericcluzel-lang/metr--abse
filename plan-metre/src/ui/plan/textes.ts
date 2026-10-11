// Disposition des textes du plan (cotes intérieures, étiquettes des pièces),
// à taille fixe à l'écran. Les largeurs de texte sont estimées : on ne peut
// pas les mesurer avant l'affichage.

import { aire, angleCote, boiteEnglobante, longueurCote, normaleExterieure, pointEtiquette, suivant } from '../../geometrie/polygone';
import { formaterValeur } from '../../metre/calcul';
import type { ID, Piece, Plan, Selection } from '../../model/types';
import { angleLisible } from './dessin';
import { versEcran, type Vue } from './vue';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface EtiquetteDisposee {
  pieceId: ID;
  x: number;
  y: number;
  /** Nom affiché (raccourci s'il ne tient pas dans la pièce), ou null : surface seule. */
  nom: string | null;
  surface: string;
  zone: Rect;
}

export interface CoteDisposee {
  cle: string;
  pieceId: ID;
  x: number;
  y: number;
  angle: number;
  texte: string;
  active: boolean;
}

/** Largeurs estimées d'un caractère (px) : nom en 14 px gras, surface en 12,5 px, cote en 11,5 px. */
const CAR_NOM = 8.2;
const CAR_SURFACE = 7;
const CAR_COTE = 6.6;
const HAUTEUR_COTE = 13;
/** Retrait de la cote vers l'intérieur de la pièce (px). */
const RETRAIT_COTE = 13;
/** Marge laissée entre l'étiquette et les murs (px). */
const MARGE_ETIQUETTE = 3;

export function seChevauchent(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function piecesDessinables(plan: Plan): Piece[] {
  return plan.pieces.filter((p) => p.sommets.length >= 3);
}

/**
 * Étiquette d'une pièce limitée à sa largeur à l'écran : le nom est raccourci
 * (« Salle d… »), puis retiré, plutôt que de déborder sur les murs voisins.
 */
function etiquette(p: Piece, vue: Vue): EtiquetteDisposee | null {
  const e = vue.echelle;
  const boite = boiteEnglobante(p.sommets);
  if (Math.min(boite.maxX - boite.minX, boite.maxY - boite.minY) * e < 34) return null;
  const disponible = (boite.maxX - boite.minX) * e - 2 * MARGE_ETIQUETTE;
  const surface = formaterValeur(aire(p.sommets) / 1e4, 'm²');
  if (surface.length * CAR_SURFACE > disponible) return null;
  let nom: string | null = p.nom || 'Sans nom';
  if (nom.length * CAR_NOM > disponible) {
    const n = Math.floor(disponible / CAR_NOM) - 1;
    nom = n >= 3 ? `${nom.slice(0, n).trimEnd()}…` : null;
  }
  const c = versEcran(vue, pointEtiquette(p.sommets));
  const demi = Math.max(nom ? nom.length * CAR_NOM : 0, surface.length * CAR_SURFACE) / 2 + 2;
  const zone = nom
    ? { x0: c.x - demi, y0: c.y - 17, x1: c.x + demi, y1: c.y + 18 }
    : { x0: c.x - demi, y0: c.y - 8, x1: c.x + demi, y1: c.y + 9 };
  return { pieceId: p.id, x: c.x, y: c.y, nom, surface, zone };
}

/**
 * Place de la cote du côté i : abscisse (cm) de son milieu le long du côté et
 * retrait vers l'intérieur (px). Au milieu du côté, sauf si l'arc d'une porte
 * qui s'ouvre dans la pièce passe dessous : la cote va alors au milieu du plus
 * long tronçon libre du côté, ou, s'il est trop court pour le texte, au-delà
 * de l'arc.
 */
function placeCote(p: Piece, i: number, l: number, largeurTexte: number, e: number): { abscisse: number; retrait: number } {
  const marge = 4 / e;
  const demi = largeurTexte / 2 / e;
  const milieu = l / 2;
  const portes = p.ouvertures
    .filter((o) => o.cote === i && (o.type === 'porte' || o.type === 'porte-fenetre') && o.versInterieur !== false)
    .map((o) => ({ debut: o.position - marge, fin: o.position + o.largeur + marge, rayon: o.type === 'porte' ? o.largeur : o.largeur / 2 }))
    .sort((a, b) => a.debut - b.debut);
  const dessous = portes.filter((o) => o.debut < milieu + demi && milieu - demi < o.fin);
  if (dessous.length === 0) return { abscisse: milieu, retrait: RETRAIT_COTE };
  let libre: [number, number] = [0, 0];
  let debut = 0;
  for (const o of [...portes, { debut: l, fin: l }]) {
    if (o.debut - debut > libre[1] - libre[0]) libre = [debut, o.debut];
    debut = Math.max(debut, o.fin);
  }
  if (libre[1] - libre[0] >= 2 * demi + 8 / e) return { abscisse: (libre[0] + libre[1]) / 2, retrait: RETRAIT_COTE };
  const rayon = Math.max(...dessous.map((o) => o.rayon)) * e;
  return { abscisse: milieu, retrait: Math.max(RETRAIT_COTE, rayon + HAUTEUR_COTE / 2 + 3) };
}

function zoneCote(x: number, y: number, angle: number, texte: string): Rect {
  const w = texte.length * CAR_COTE;
  const r = (angle * Math.PI) / 180;
  const hx = (Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * HAUTEUR_COTE) / 2;
  const hy = (Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * HAUTEUR_COTE) / 2;
  return { x0: x - hx, y0: y - hy, x1: x + hx, y1: y + hy };
}

/**
 * Cotes et étiquettes à afficher. Une cote qui recouvrirait une étiquette est
 * masquée (elle réapparaît en zoomant), sauf celle du côté sélectionné : c'est
 * alors l'étiquette qui s'efface le temps de la sélection.
 */
export function disposerTextes(
  plan: Plan,
  vue: Vue,
  selection: Selection | null,
): { etiquettes: EtiquetteDisposee[]; cotes: CoteDisposee[] } {
  const e = vue.echelle;
  const pieces = piecesDessinables(plan);
  const cotes: CoteDisposee[] = [];
  for (const p of pieces) {
    for (let i = 0; i < p.sommets.length; i++) {
      const l = longueurCote(p.sommets, i);
      if (l * e < 46) continue;
      const texte = `${Math.round(l)} cm`;
      const a = p.sommets[i];
      const b = suivant(p.sommets, i);
      const place = placeCote(p, i, l, texte.length * CAR_COTE, e);
      const t = place.abscisse / (l || 1);
      const m = versEcran(vue, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const n = normaleExterieure(p.sommets, i);
      const active = selection?.type === 'cote' && selection.pieceId === p.id && selection.index === i;
      cotes.push({
        cle: `${p.id}-${i}`,
        pieceId: p.id,
        x: m.x - n.x * place.retrait,
        y: m.y - n.y * place.retrait,
        angle: angleLisible((angleCote(p.sommets, i) * 180) / Math.PI),
        texte,
        active,
      });
    }
  }
  const coteActive = cotes.find((c) => c.active);
  const zoneActive = coteActive && zoneCote(coteActive.x, coteActive.y, coteActive.angle, coteActive.texte);
  const etiquettes: EtiquetteDisposee[] = [];
  for (const p of pieces) {
    const et = etiquette(p, vue);
    if (et && !(zoneActive && seChevauchent(zoneActive, et.zone))) etiquettes.push(et);
  }
  return {
    etiquettes,
    cotes: cotes.filter((c) => c.active || !etiquettes.some((et) => seChevauchent(et.zone, zoneCote(c.x, c.y, c.angle, c.texte)))),
  };
}
