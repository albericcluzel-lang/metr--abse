// Symboles dessinés dans le repère du plan (cm) : équipements et ouvertures.
// `px` = taille d'un pixel écran en cm, pour garder des traits fins à tout zoom.

import type { Catalogue, Equipement, Ouverture, Piece, TypeEquipement } from '../../model/types';
import { cheminFerme, geometrieOuverture } from './dessin';

function formes(type: TypeEquipement, l: number, p: number, trait: number) {
  const m = Math.min(l, p);
  const x0 = -l / 2;
  const y0 = -p / 2;
  switch (type) {
    case 'baignoire': {
      const marge = m * 0.12;
      return (
        <>
          <rect x={x0 + marge} y={y0 + marge} width={l - 2 * marge} height={p - 2 * marge} rx={m * 0.32} />
          <circle cx={l / 2 - marge - m * 0.16} cy={0} r={m * 0.05} />
        </>
      );
    }
    case 'douche':
      return (
        <>
          <line x1={x0} y1={y0} x2={-x0} y2={-y0} />
          <line x1={-x0} y1={y0} x2={x0} y2={-y0} />
          <circle cx={0} cy={0} r={m * 0.07} className="plan2d-equipement-plein" />
        </>
      );
    case 'meuble-vasque':
      return <ellipse cx={0} cy={p * 0.06} rx={l * 0.3} ry={p * 0.3} />;
    case 'lavabo':
      return <ellipse cx={0} cy={p * 0.04} rx={l * 0.38} ry={p * 0.34} />;
    case 'wc': {
      const reservoir = p * 0.28;
      return (
        <>
          <rect x={x0 + l * 0.04} y={y0} width={l * 0.92} height={reservoir} rx={m * 0.06} />
          <ellipse cx={0} cy={y0 + reservoir + (p - reservoir) * 0.48} rx={l * 0.4} ry={(p - reservoir) * 0.46} />
        </>
      );
    }
    case 'evier': {
      const marge = m * 0.12;
      return (
        <>
          <rect x={x0 + marge} y={y0 + marge} width={l * 0.42} height={p - 2 * marge} rx={m * 0.08} />
          {[0.62, 0.74, 0.86].map((f) => (
            <line key={f} x1={x0 + l * f} y1={y0 + marge} x2={x0 + l * f} y2={-y0 - marge} />
          ))}
        </>
      );
    }
    case 'meuble-cuisine':
      return <line x1={x0} y1={-y0 - p * 0.14} x2={-x0} y2={-y0 - p * 0.14} strokeDasharray={`${trait * 4} ${trait * 3}`} />;
    case 'placard':
      return (
        <>
          <line x1={x0 + m * 0.1} y1={0} x2={-x0 - m * 0.1} y2={0} />
          {[-0.3, 0, 0.3].map((f) => (
            <line key={f} x1={l * f - m * 0.08} y1={-p * 0.22} x2={l * f + m * 0.08} y2={p * 0.22} />
          ))}
        </>
      );
    case 'radiateur': {
      const n = Math.max(3, Math.round(l / 8));
      return (
        <>
          {Array.from({ length: n - 1 }, (_, k) => (
            <line key={k} x1={x0 + ((k + 1) * l) / n} y1={y0} x2={x0 + ((k + 1) * l) / n} y2={-y0} />
          ))}
        </>
      );
    }
    case 'ballon-ecs':
      return <circle cx={0} cy={0} r={m * 0.42} />;
    case 'autre':
      return (
        <>
          <line x1={x0} y1={y0} x2={-x0} y2={-y0} />
          <line x1={-x0} y1={y0} x2={x0} y2={-y0} />
        </>
      );
  }
}

export function SymboleEquipement({ e, selectionne, px }: { e: Equipement; selectionne: boolean; px: number }) {
  const trait = (selectionne ? 2.2 : 1.2) * px;
  return (
    <g
      className={`plan2d-equipement${selectionne ? ' selectionne' : ''}`}
      transform={`translate(${e.x} ${e.y}) rotate(${e.rotation})`}
      strokeWidth={trait}
      data-equipement={e.id}
      data-type={e.type}
    >
      <rect x={-e.largeur / 2} y={-e.profondeur / 2} width={e.largeur} height={e.profondeur} className="plan2d-equipement-cadre" />
      <g className="plan2d-equipement-detail" strokeWidth={1 * px}>
        {formes(e.type, e.largeur, e.profondeur, px)}
      </g>
    </g>
  );
}

export function SymboleOuverture({
  piece,
  o,
  catalogue,
  selectionne,
  px,
}: {
  piece: Piece;
  o: Ouverture;
  catalogue: Catalogue;
  selectionne: boolean;
  px: number;
}) {
  const g = geometrieOuverture(piece, o, catalogue, 0.8 * px);
  if (!g) return null;
  const ligne = (s: [{ x: number; y: number }, { x: number; y: number }], i: number, classe: string, largeur: number) => (
    <line key={`${classe}-${i}`} className={classe} x1={s[0].x} y1={s[0].y} x2={s[1].x} y2={s[1].y} strokeWidth={largeur * px} />
  );
  return (
    <g className={`plan2d-ouverture${selectionne ? ' selectionnee' : ''}`} data-ouverture={o.id} data-type={o.type}>
      {g.decoupe.length > 0 && (
        <path className="plan2d-ouverture-decoupe" d={cheminFerme(g.decoupe)} strokeWidth={(selectionne ? 2 : 0) * px} />
      )}
      {g.traits.map((s, i) => ligne(s, i, 'plan2d-ouverture-trait', selectionne ? 1.6 : 1.1))}
      {g.arcs.map((a, i) => (
        <path
          key={`arc-${i}`}
          className="plan2d-ouverture-arc"
          d={`M${a.depart.x} ${a.depart.y}A${a.rayon} ${a.rayon} 0 0 ${a.sens} ${a.arrivee.x} ${a.arrivee.y}`}
          strokeWidth={1 * px}
          strokeDasharray={`${4 * px} ${3 * px}`}
        />
      ))}
      {g.vantaux.map((s, i) => ligne(s, i, 'plan2d-ouverture-vantail', selectionne ? 2.6 : 2))}
    </g>
  );
}
