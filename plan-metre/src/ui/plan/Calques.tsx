// Calques du plan : quadrillage, pièces (dans le repère du plan, en cm) et
// calques à taille fixe à l'écran (cotes, étiquettes, poignées, épingles
// photo, tracé en cours), pour rester lisibles à tout niveau de zoom.

import { memo, type ReactNode } from 'react';
import { contourExterieur, epaisseurCote, typeMurIdCote } from '../../geometrie/piece';
import {
  aire,
  angleCote,
  boiteEnglobante,
  distance,
  longueurCote,
  normaleExterieure,
  pointEtiquette,
  suivant,
} from '../../geometrie/polygone';
import { formaterValeur } from '../../metre/calcul';
import type { Catalogue, ID, Photo, Piece, Plan, Point, Selection } from '../../model/types';
import { Icone } from '../commun/Icone';
import type { Aimant } from './aimantation';
import { angleLisible, cheminFerme, couleurSol } from './dessin';
import { SymboleEquipement, SymboleOuverture } from './symboles';
import { ECART_POIGNEE_MILIEU_PX, poigneesMilieux } from './touche';
import { pasGrille, versEcran, type Vue } from './vue';

/** Rayons de touche (px écran) des poignées. */
export const TOUCHE_SOMMET_PX = 22;
export const TOUCHE_MILIEU_PX = 18;
export const TOUCHE_MILIEU_TACTILE_PX = 22;
/** Un côté plus court que cela à l'écran n'a pas de poignée « + ». */
export const COTE_MIN_MILIEU_PX = 76;
/** Épingle photo : centre de la tête au-dessus du point, et rayon de touche. */
export const EPINGLE_TETE_PX = 22;
export const EPINGLE_TOUCHE_PX = 20;

/** Pièce concernée par la sélection (pièce, côté, sommet, ouverture, équipement). */
export function pieceActive(selection: Selection | null): ID | null {
  return selection && selection.type !== 'photo' ? selection.pieceId : null;
}

function piecesDessinables(plan: Plan): Piece[] {
  return plan.pieces.filter((p) => p.sommets.length >= 3);
}

// ─── Quadrillage ─────────────────────────────────────────────────────────

export function Grille({ vue, largeur, hauteur }: { vue: Vue; largeur: number; hauteur: number }) {
  const { fin, fort } = pasGrille(vue.echelle);
  const lignes = (pas: number) => {
    const d: string[] = [];
    const e = vue.echelle;
    for (let k = Math.ceil(-vue.tx / e / pas); k * pas * e + vue.tx <= largeur; k++) {
      d.push(`M${Math.round(k * pas * e + vue.tx) + 0.5} 0V${hauteur}`);
    }
    for (let k = Math.ceil(-vue.ty / e / pas); k * pas * e + vue.ty <= hauteur; k++) {
      d.push(`M0 ${Math.round(k * pas * e + vue.ty) + 0.5}H${largeur}`);
    }
    return d.join('');
  };
  return (
    <g className="plan2d-grille" aria-hidden="true">
      <path className="fine" d={lignes(fin)} />
      <path className="forte" d={lignes(fort)} />
    </g>
  );
}

// ─── Pièces (repère du plan) ─────────────────────────────────────────────

interface PropsCalquePlan {
  plan: Plan;
  catalogue: Catalogue;
  selection: Selection | null;
  echelle: number;
}

/** Sols, équipements, murs et ouvertures. Ne dépend pas du déplacement de la vue. */
export const CalquePlan = memo(function CalquePlan({ plan, catalogue, selection, echelle }: PropsCalquePlan) {
  const px = 1 / echelle;
  const idActif = pieceActive(selection);
  const pieces = piecesDessinables(plan);
  const active = pieces.find((p) => p.id === idActif);
  // La pièce active est dessinée en dernier : son mur passe au-dessus des murs mitoyens.
  const ordreMurs = active ? [...pieces.filter((p) => p !== active), active] : pieces;
  const sansMur: ReactNode[] = [];
  for (const p of pieces) {
    p.sommets.forEach((a, i) => {
      if (typeMurIdCote(p, i) !== null) return;
      const b = suivant(p.sommets, i);
      sansMur.push(
        <line
          key={`${p.id}-${i}`}
          className="plan2d-sans-mur"
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          strokeWidth={1.2 * px}
          strokeDasharray={`${5 * px} ${4 * px}`}
        />,
      );
    });
  }
  return (
    <g className="plan2d-calque-plan">
      {pieces.map((p) => (
        <path key={p.id} className="plan2d-sol" d={cheminFerme(p.sommets)} fill={couleurSol(p, catalogue)} data-piece={p.id} />
      ))}
      {active && <path className="plan2d-sol-actif" d={cheminFerme(active.sommets)} />}
      {pieces.map((p) =>
        p.equipements.map((e) => (
          <SymboleEquipement
            key={e.id}
            e={e}
            px={px}
            selectionne={selection?.type === 'equipement' && selection.equipementId === e.id}
          />
        )),
      )}
      {ordreMurs.map((p) => (
        <path
          key={p.id}
          className={`plan2d-mur${selection?.type === 'piece' && selection.pieceId === p.id ? ' actif' : ''}`}
          d={cheminFerme(contourExterieur(p, catalogue)) + cheminFerme(p.sommets)}
          fillRule="evenodd"
        />
      ))}
      {sansMur}
      {pieces.map((p) =>
        p.ouvertures.map((o) => (
          <SymboleOuverture
            key={o.id}
            piece={p}
            o={o}
            catalogue={catalogue}
            px={px}
            selectionne={selection?.type === 'ouverture' && selection.ouvertureId === o.id}
          />
        )),
      )}
      {selection?.type === 'cote' && active && <CoteSelectionne piece={active} index={selection.index} catalogue={catalogue} px={px} />}
    </g>
  );
});

function CoteSelectionne({ piece, index, catalogue, px }: { piece: Piece; index: number; catalogue: Catalogue; px: number }) {
  const a = piece.sommets[index];
  if (!a) return null;
  const b = suivant(piece.sommets, index);
  const n = normaleExterieure(piece.sommets, index);
  const ep = epaisseurCote(piece, index, catalogue);
  const bande = [a, b, { x: b.x + n.x * ep, y: b.y + n.y * ep }, { x: a.x + n.x * ep, y: a.y + n.y * ep }];
  return (
    <g className="plan2d-cote-selection">
      {ep > 0 && <path d={cheminFerme(bande)} />}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={3.5 * px} />
    </g>
  );
}

// ─── Textes (repère écran) ───────────────────────────────────────────────

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function seChevauchent(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * Cotes intérieures et étiquettes des pièces, à taille fixe à l'écran. Une
 * cote qui recouvrirait l'étiquette d'une pièce est masquée (elle réapparaît
 * en zoomant), sauf celle du côté sélectionné.
 */
export function CalqueTextes({ plan, vue, selection }: { plan: Plan; vue: Vue; selection: Selection | null }) {
  const e = vue.echelle;
  const idActif = pieceActive(selection);
  const pieces = piecesDessinables(plan);
  const etiquettes: ReactNode[] = [];
  const zonesEtiquettes: Rect[] = [];
  for (const p of pieces) {
    const boite = boiteEnglobante(p.sommets);
    if (Math.min(boite.maxX - boite.minX, boite.maxY - boite.minY) * e < 34) continue;
    const c = versEcran(vue, pointEtiquette(p.sommets));
    const nom = p.nom || 'Sans nom';
    const surface = formaterValeur(aire(p.sommets) / 1e4, 'm²');
    // Largeur estimée du texte (pas de mesure possible avant affichage).
    const demi = Math.max(nom.length * 8.2, surface.length * 7) / 2 + 2;
    zonesEtiquettes.push({ x0: c.x - demi, y0: c.y - 17, x1: c.x + demi, y1: c.y + 18 });
    etiquettes.push(
      <text key={p.id} className={`plan2d-etiquette${idActif === p.id ? ' active' : ''}`} x={c.x} y={c.y} data-etiquette={p.id}>
        <tspan className="plan2d-etiquette-nom" x={c.x} y={c.y - 3}>
          {nom}
        </tspan>
        <tspan className="plan2d-etiquette-surface" x={c.x} y={c.y + 13}>
          {surface}
        </tspan>
      </text>,
    );
  }
  const cotes: ReactNode[] = [];
  let coteActive: ReactNode = null;
  for (const p of pieces) {
    for (let i = 0; i < p.sommets.length; i++) {
      const l = longueurCote(p.sommets, i);
      if (l * e < 46) continue;
      const a = p.sommets[i];
      const b = suivant(p.sommets, i);
      const m = versEcran(vue, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const n = normaleExterieure(p.sommets, i);
      const angle = angleLisible((angleCote(p.sommets, i) * 180) / Math.PI);
      const actif = selection?.type === 'cote' && selection.pieceId === p.id && selection.index === i;
      const x = m.x - n.x * 13;
      const y = m.y - n.y * 13;
      const texte = `${Math.round(l)} cm`;
      if (!actif) {
        const w = texte.length * 6.6;
        const h = 13;
        const r = (angle * Math.PI) / 180;
        const hx = (Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h) / 2;
        const hy = (Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h) / 2;
        const zone = { x0: x - hx, y0: y - hy, x1: x + hx, y1: y + hy };
        if (zonesEtiquettes.some((z) => seChevauchent(z, zone))) continue;
      }
      const element = (
        <text
          key={`${p.id}-${i}`}
          className={`plan2d-cote${actif ? ' active' : ''}`}
          transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(2)})`}
        >
          {texte}
        </text>
      );
      if (actif) coteActive = element;
      else cotes.push(element);
    }
  }
  return (
    <g className="plan2d-textes">
      {cotes}
      {etiquettes}
      {coteActive}
    </g>
  );
}

// ─── Poignées de la pièce active ─────────────────────────────────────────

export function CalquePoignees({
  piece,
  catalogue,
  vue,
  selection,
}: {
  piece: Piece;
  catalogue: Catalogue;
  vue: Vue;
  selection: Selection | null;
}) {
  const pts = piece.sommets.map((s) => versEcran(vue, s));
  const milieux = poigneesMilieux(piece, catalogue, (p) => versEcran(vue, p), vue.echelle, COTE_MIN_MILIEU_PX);
  return (
    <g className="plan2d-poignees">
      {milieux.map((m, i) => {
        if (!m) return null;
        // Petit trait qui relie la poignée à la face extérieure du mur.
        const a = pts[i];
        const b = suivant(pts, i);
        const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const d = distance(c, m) || 1;
        const u = { x: (c.x - m.x) / d, y: (c.y - m.y) / d };
        return (
          <g key={`m${i}`} className="plan2d-poignee-milieu" transform={`translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})`}>
            <line x1={u.x * 9} y1={u.y * 9} x2={u.x * ECART_POIGNEE_MILIEU_PX} y2={u.y * ECART_POIGNEE_MILIEU_PX} />
            <circle r={9} />
            <path d="M-4.5 0H4.5M0 -4.5V4.5" />
          </g>
        );
      })}
      {pts.map((p, i) => (
        <circle
          key={`s${i}`}
          className={`plan2d-poignee-sommet${selection?.type === 'sommet' && selection.index === i ? ' selectionnee' : ''}`}
          cx={p.x}
          cy={p.y}
          r={8}
        />
      ))}
    </g>
  );
}

// ─── Épingles photo ──────────────────────────────────────────────────────

export function CalquePhotos({ photos, vue, selection }: { photos: Photo[]; vue: Vue; selection: Selection | null }) {
  return (
    <g className="plan2d-epingles">
      {photos.map((ph) => {
        if (!ph.position) return null;
        const s = versEcran(vue, ph.position);
        const sel = selection?.type === 'photo' && selection.photoId === ph.id;
        return (
          <g
            key={ph.id}
            className={`plan2d-epingle${sel ? ' selectionnee' : ''}`}
            transform={`translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`}
            data-photo={ph.id}
          >
            <title>{ph.legende || 'Photo'}</title>
            <path d="M0 0C-4 -7 -15 -12 -15 -22A15 15 0 1 1 15 -22C15 -12 4 -7 0 0Z" />
            <g transform="translate(-9 -31)" className="plan2d-epingle-icone">
              <Icone nom="photo" taille={18} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

// ─── Tracé d'une nouvelle pièce ──────────────────────────────────────────

export function CalqueTrace({ trace, curseur, vue }: { trace: Point[]; curseur: Aimant | null; vue: Vue }) {
  const pts = trace.map((p) => versEcran(vue, p));
  const c = curseur ? versEcran(vue, curseur.point) : null;
  const dernier = pts[pts.length - 1];
  const fermable = pts.length >= 3;
  let etiquette: ReactNode = null;
  if (dernier && c && curseur && trace.length > 0) {
    const l = distance(trace[trace.length - 1], curseur.point);
    const d = distance(dernier, c);
    if (l >= 1 && d > 4) {
      // Longueur écrite au milieu du segment élastique, décalée sur le côté.
      const nx = -(c.y - dernier.y) / d;
      const ny = (c.x - dernier.x) / d;
      const angle = angleLisible((Math.atan2(c.y - dernier.y, c.x - dernier.x) * 180) / Math.PI);
      etiquette = (
        <text
          className="plan2d-trace-longueur"
          transform={`translate(${((dernier.x + c.x) / 2 + nx * 16).toFixed(1)} ${((dernier.y + c.y) / 2 + ny * 16).toFixed(1)}) rotate(${angle.toFixed(2)})`}
        >
          {Math.round(l)} cm
        </text>
      );
    }
  }
  return (
    <g className="plan2d-trace">
      {pts.length >= 2 && <polyline className="plan2d-trace-ligne" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />}
      {dernier && c && pts.length >= 2 && !curseur?.ferme && (
        <line className="plan2d-trace-fermeture" x1={c.x} y1={c.y} x2={pts[0].x} y2={pts[0].y} />
      )}
      {dernier && c && <line className="plan2d-trace-elastique" x1={dernier.x} y1={dernier.y} x2={c.x} y2={c.y} />}
      {pts.map((p, i) => (
        <circle
          key={i}
          className={i === 0 && fermable ? `plan2d-trace-premier${curseur?.ferme ? ' actif' : ''}` : 'plan2d-trace-point'}
          cx={p.x}
          cy={p.y}
          r={i === 0 && fermable ? 10 : 5}
        />
      ))}
      {c && curseur && !curseur.ferme && (
        <g className={`plan2d-reticule ${curseur.type}`} transform={`translate(${c.x} ${c.y})`}>
          <circle r={curseur.type === 'sommet' ? 9 : 6} />
          <path d="M-14 0H-8M8 0H14M0 -14V-8M0 8V14" />
        </g>
      )}
      {etiquette}
    </g>
  );
}
