// Géométrie du dessin (sans React) : chemins SVG, orientation des cotes,
// symboles des ouvertures.

import { epaisseurCote, segmentOuverture } from '../../geometrie/piece';
import { normaleExterieure, pointEtiquette, suivant } from '../../geometrie/polygone';
import type { Catalogue, Ouverture, Photo, Piece, Plan, Point, Selection } from '../../model/types';

function fmt(v: number): string {
  return Number(v.toFixed(3)).toString();
}

/** Chemin SVG fermé (« M x y L … Z »). */
export function cheminFerme(points: readonly Point[]): string {
  if (points.length === 0) return '';
  return `M${points.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join('L')}Z`;
}

/** Ramène un angle (degrés) dans ]-90, 90] pour qu'un texte ne soit jamais à l'envers. */
export function angleLisible(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  if (a > 90) a -= 180;
  else if (a <= -90) a += 180;
  return a + 0;
}

/** Point représentatif de la sélection (pour la garder visible à l'écran). */
export function pointDeSelection(s: Selection, plan: Plan, photos: readonly Photo[]): Point | null {
  if (s.type === 'photo') return photos.find((p) => p.id === s.photoId)?.position ?? null;
  const piece = plan.pieces.find((p) => p.id === s.pieceId);
  if (!piece || piece.sommets.length < 3) return null;
  switch (s.type) {
    case 'piece':
      return pointEtiquette(piece.sommets);
    case 'sommet':
      return piece.sommets[s.index] ?? null;
    case 'cote': {
      const a = piece.sommets[s.index];
      if (!a) return null;
      const b = suivant(piece.sommets, s.index);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    case 'ouverture': {
      const o = piece.ouvertures.find((x) => x.id === s.ouvertureId);
      const seg = o && segmentOuverture(piece, o);
      return seg ? { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 } : null;
    }
    case 'equipement': {
      const e = piece.equipements.find((x) => x.id === s.equipementId);
      return e ? { x: e.x, y: e.y } : null;
    }
  }
}

/** Couleur du sol d'une pièce : celle du revêtement, sinon blanc. */
export function couleurSol(piece: Piece, catalogue: Catalogue): string {
  const r = catalogue.revetementsSol.find((x) => x.id === piece.revetementSolId);
  return r?.couleur ?? '#ffffff';
}

export type Segment = [Point, Point];

export interface ArcPorte {
  depart: Point;
  arrivee: Point;
  rayon: number;
  /** Drapeau « sweep » SVG : 1 = sens horaire à l'écran. */
  sens: 0 | 1;
}

export interface GeometrieOuverture {
  /** Découpe de la bande de mur (polygone), vide sans mur. */
  decoupe: Point[];
  /** Traits fins (tableaux, vitrages). */
  traits: Segment[];
  /** Vantaux des portes (traits épais). */
  vantaux: Segment[];
  /** Débattements des portes. */
  arcs: ArcPorte[];
}

function plus(a: Point, v: Point, k: number): Point {
  return { x: a.x + v.x * k, y: a.y + v.y * k };
}

function sensArc(centre: Point, depart: Point, arrivee: Point): 0 | 1 {
  const r1 = { x: depart.x - centre.x, y: depart.y - centre.y };
  const r2 = { x: arrivee.x - centre.x, y: arrivee.y - centre.y };
  return r1.x * r2.y - r1.y * r2.x > 0 ? 1 : 0;
}

/** Vantail ouvert à 90° depuis la charnière `h`, fermant sur `j`. */
function vantail(h: Point, j: Point, v: Point, largeur: number): { trait: Segment; arc: ArcPorte } {
  const bout = plus(h, v, largeur);
  return { trait: [h, bout], arc: { depart: bout, arrivee: j, rayon: largeur, sens: sensArc(h, bout, j) } };
}

/**
 * Symbole d'une ouverture dans le repère du plan (cm). `marge` élargit un peu
 * la découpe pour masquer l'anticrénelage du mur (≈ 1 px écran).
 */
export function geometrieOuverture(
  piece: Piece,
  o: Ouverture,
  catalogue: Catalogue,
  marge = 0.5,
): GeometrieOuverture | null {
  const seg = segmentOuverture(piece, o);
  if (!seg || seg.fin - seg.debut <= 0) return null;
  const n = normaleExterieure(piece.sommets, o.cote);
  const ep = epaisseurCote(piece, o.cote, catalogue);
  const { a, b } = seg;
  const largeur = seg.fin - seg.debut;
  const res: GeometrieOuverture = { decoupe: [], traits: [], vantaux: [], arcs: [] };
  if (ep > 0) {
    const a0 = plus(a, n, -marge);
    const b0 = plus(b, n, -marge);
    res.decoupe = [a0, b0, plus(b0, n, ep + 2 * marge), plus(a0, n, ep + 2 * marge)];
    // Tableaux (bords de l'ouverture dans l'épaisseur du mur).
    res.traits.push([a, plus(a, n, ep)], [b, plus(b, n, ep)]);
  }
  // Épaisseur de dessin des vitrages quand il n'y a pas de mur.
  const e = ep > 0 ? ep : 4;
  const decal = ep > 0 ? 0 : -2;
  const lignes = (fractions: number[]) => {
    for (const f of fractions) res.traits.push([plus(a, n, decal + e * f), plus(b, n, decal + e * f)]);
  };
  switch (o.type) {
    case 'fenetre':
      lignes([1 / 3, 2 / 3]);
      break;
    case 'baie':
      lignes([1 / 4, 1 / 2, 3 / 4]);
      break;
    case 'porte':
    case 'porte-fenetre': {
      const interieur = o.versInterieur !== false;
      const face = interieur ? 0 : ep;
      const v = interieur ? { x: -n.x, y: -n.y } : n;
      const fa = plus(a, n, face);
      const fb = plus(b, n, face);
      if (o.type === 'porte') {
        const [h, j] = o.charniere === 'fin' ? [fb, fa] : [fa, fb];
        const { trait, arc } = vantail(h, j, v, largeur);
        res.vantaux.push(trait);
        res.arcs.push(arc);
      } else {
        // Porte-fenêtre à deux vantaux, et vitrage dans l'épaisseur du mur.
        const milieu = { x: (fa.x + fb.x) / 2, y: (fa.y + fb.y) / 2 };
        for (const h of [fa, fb]) {
          const { trait, arc } = vantail(h, milieu, v, largeur / 2);
          res.vantaux.push(trait);
          res.arcs.push(arc);
        }
        lignes([1 / 2]);
      }
      break;
    }
    case 'passage':
      break;
  }
  return res;
}
