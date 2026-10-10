// Aperçus SVG du relevé : vignette d'une zone, tracé en direct du mètre laser,
// assemblage des zones sur le plan cible.

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Point } from '../../model/types';
import { aire, aireSignee, distance, pointEtiquette } from '../../geometrie/polygone';
import { formaterValeur } from '../../metre/calcul';
import { cadrer, cheminSvg, type Cadrage } from './geometrieReleve';
import { directionCap, type TraceLaser } from './laser';

function identifiantSvg(id: string): string {
  return `releve-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Quadrillage d'un mètre (ou de 5 m si le dessin est très réduit), calé sur l'origine du plan. */
function Quadrillage({ cadrage, largeur, hauteur }: { cadrage: Cadrage; largeur: number; hauteur: number }) {
  const id = identifiantSvg(useId());
  let pas = cadrage.echelle * 100;
  if (pas < 12) pas *= 5;
  const o = cadrage.transformer({ x: 0, y: 0 });
  return (
    <>
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" x={o.x} y={o.y} width={pas} height={pas}>
          <path d={`M${pas} 0H0V${pas}`} className="releve-grille" />
        </pattern>
      </defs>
      <rect width={largeur} height={hauteur} fill={`url(#${id})`} />
    </>
  );
}

/**
 * Taille réelle (px) du dessin, pour que traits et textes gardent la même
 * taille à l'écran quel que soit l'espace disponible (téléphone ou PC).
 */
function useTailleDessin(defaut: { l: number; h: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [taille, setTaille] = useState(defaut);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mesurer = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      setTaille((t) => (Math.abs(t.l - r.width) < 1 && Math.abs(t.h - r.height) < 1 ? t : { l: r.width, h: r.height }));
    };
    mesurer();
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, taille] as const;
}

/**
 * Position d'une cote le long du segment [a, b], côté `sens` (+1 : à gauche
 * du sens de parcours), avec l'ancrage du texte qui l'écarte du trait.
 */
function placerCote(a: Point, b: Point, sens: number, ecart = 9): { x: number; y: number; ancre: 'start' | 'middle' | 'end' } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (dy / l) * sens;
  const ny = (-dx / l) * sens;
  const x = (a.x + b.x) / 2 + nx * ecart;
  const y = (a.y + b.y) / 2 + ny * ecart;
  const ancre = nx > 0.5 ? 'start' : nx < -0.5 ? 'end' : 'middle';
  // Ligne de base : sous le trait, au-dessus, ou centrée sur un trait vertical.
  return { x, y: y + (ny > 0.5 ? 12 : ny < -0.5 ? -3 : 4.5), ancre };
}

export function surfaceM2(points: readonly Point[]): string {
  return formaterValeur(aire(points) / 10000, 'm²');
}

export function VignetteZone({ points, taille = 56 }: { points: readonly Point[]; taille?: number }) {
  const c = cadrer(points, 64, 64, 7, 10);
  return (
    <svg className="releve-vignette" viewBox="0 0 64 64" width={taille} height={taille} aria-hidden="true" focusable="false">
      <path d={cheminSvg(points.map(c.transformer), true)} />
    </svg>
  );
}


/**
 * Tracé en direct du relevé au mètre laser : côtés saisis, côté en cours,
 * segment de fermeture en pointillés, point de départ et direction suivante.
 */
export function ApercuLaser({ trace, coteEnCours }: { trace: TraceLaser; coteEnCours: boolean }) {
  const [ref, { l: LA, h: HA }] = useTailleDessin({ l: 400, h: 260 });
  const { sommets, extremite } = trace;
  const parcours = [...sommets, extremite];
  const c = cadrer(parcours, LA, HA, 60, 1.2);
  // Les cotes se placent à l'extérieur de la pièce, quel que soit le sens du tour.
  const sens = aireSignee(parcours) >= 0 ? 1 : -1;
  const t = c.transformer;
  const pts = parcours.map(t);
  const depart = pts[0];
  const fin = pts[pts.length - 1];
  const dir = directionCap(trace.cap);
  const pointe = { x: fin.x + dir.x * 30, y: fin.y + dir.y * 30 };
  const n = sommets.length;
  const fermeture = n >= 1 && trace.ecartFermeture >= 0.5;
  const coteFermeture = placerCote(fin, depart, sens);
  const idFleche = identifiantSvg(useId());

  return (
    <svg
      ref={ref}
      className="releve-apercu"
      viewBox={`0 0 ${LA} ${HA}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={
        n === 0
          ? 'Aperçu du relevé : aucun côté saisi'
          : `Aperçu du relevé : ${n} côté${n > 1 ? 's' : ''}, fermeture ${Math.round(trace.ecartFermeture)} cm`
      }
    >
      <Quadrillage cadrage={c} largeur={LA} hauteur={HA} />
      <defs>
        <marker id={idFleche} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="releve-fleche-pointe" />
        </marker>
      </defs>
      {fermeture && (
        <>
          <line x1={fin.x} y1={fin.y} x2={depart.x} y2={depart.y} className="releve-trace-fermeture" />
          <text x={coteFermeture.x} y={coteFermeture.y} className="releve-cote releve-cote-fermeture" textAnchor={coteFermeture.ancre}>
            {`${Math.round(trace.ecartFermeture)} cm`}
          </text>
        </>
      )}
      {n > 0 && (
        <path d={cheminSvg(coteEnCours ? pts.slice(0, -1) : pts, false)} className="releve-trace" />
      )}
      {coteEnCours && n > 0 && (
        <line x1={pts[n - 1].x} y1={pts[n - 1].y} x2={fin.x} y2={fin.y} className="releve-trace releve-trace-en-cours" />
      )}
      {sommets.map((s, i) => {
        const l = distance(s, parcours[i + 1]);
        const cote = placerCote(pts[i], pts[i + 1], sens);
        return (
          <text key={i} x={cote.x} y={cote.y} className="releve-cote" textAnchor={cote.ancre}>
            {Math.round(l * 10) / 10}
          </text>
        );
      })}
      <line x1={fin.x} y1={fin.y} x2={pointe.x} y2={pointe.y} className="releve-fleche" markerEnd={`url(#${idFleche})`} />
      <circle cx={depart.x} cy={depart.y} r={6} className="releve-point-depart" />
      {n === 0 && (
        <text x={depart.x} y={depart.y + 22} className="releve-cote" textAnchor="middle">
          Départ
        </text>
      )}
      {n > 0 && <circle cx={fin.x} cy={fin.y} r={4.5} className="releve-point-courant" />}
    </svg>
  );
}

export interface PieceApercu {
  id: string;
  nom: string;
  points: Point[];
}

/** Assemblage : pièces existantes du plan cible (grisées) et nouvelles pièces. */
export function ApercuAssemblage({
  existantes,
  nouvelles,
}: {
  existantes: readonly Point[][];
  nouvelles: readonly PieceApercu[];
}) {
  const [ref, { l: L, h: H }] = useTailleDessin({ l: 400, h: 240 });
  const c = cadrer([...existantes.flat(), ...nouvelles.flatMap((p) => p.points)], L, H, 22, 1);
  const t = c.transformer;
  return (
    <svg
      ref={ref}
      className="releve-apercu"
      viewBox={`0 0 ${L} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Aperçu du plan : ${nouvelles.length} nouvelle${nouvelles.length > 1 ? 's' : ''} pièce${
        nouvelles.length > 1 ? 's' : ''
      }${existantes.length ? `, ${existantes.length} existante${existantes.length > 1 ? 's' : ''}` : ''}`}
    >
      <Quadrillage cadrage={c} largeur={L} hauteur={H} />
      {existantes.map((pts, i) => (
        <path key={`e${i}`} d={cheminSvg(pts.map(t), true)} className="releve-piece-existante" />
      ))}
      {nouvelles.map((p) => (
        <path key={p.id} d={cheminSvg(p.points.map(t), true)} className="releve-piece-nouvelle" />
      ))}
      {nouvelles.map((p) => {
        const e = t(pointEtiquette(p.points));
        return (
          <text key={`t${p.id}`} x={e.x} y={e.y} className="releve-etiquette" textAnchor="middle">
            <tspan x={e.x} dy="-0.2em">
              {p.nom}
            </tspan>
            <tspan x={e.x} dy="1.2em" className="releve-etiquette-surface">
              {surfaceM2(p.points)}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
