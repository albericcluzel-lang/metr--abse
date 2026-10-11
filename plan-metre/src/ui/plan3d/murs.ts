// Découpage d'un côté de mur autour de ses ouvertures (logique pure, sans WebGL).
//
// Chaque côté de pièce portant un mur est décrit dans un repère local :
//   s : abscisse le long du nu intérieur (cm, 0 au sommet de départ du côté) ;
//   t : distance vers l'extérieur (cm, 0 sur le nu intérieur) ;
//   z : hauteur au-dessus du sol (cm).
//
// Vu de dessus, le mur occupe le trapèze compris entre le côté intérieur et le
// côté correspondant du contour extérieur (angles en onglet). Les ouvertures le
// traversent de part en part, perpendiculairement au côté.
//
// Le mur est quadrillé : colonnes (bornes en s : onglets, extrémités du côté,
// tableaux des ouvertures) × bandes (bornes en z : sol, allèges, linteaux,
// plafond). Une cellule est pleine si aucune ouverture ne la couvre. Ce
// quadrillage sert à la fois au découpage en morceaux (trumeaux, allèges,
// linteaux) et à la construction des faces 3D sans faces cachées ni arêtes
// parasites.

/** Ouverture qui perce le côté (cm, repère local). */
export interface Percement {
  /** Abscisse du tableau de départ le long du côté. */
  debut: number;
  largeur: number;
  /** Hauteur du bas de l'ouverture au-dessus du sol. */
  allege: number;
  hauteur: number;
}

export type NatureMorceau = 'plein' | 'allege' | 'linteau' | 'entre-deux';

/** Morceau de mur plein, rectangulaire dans le plan du mur (s, z). */
export interface MorceauMur {
  debut: number;
  fin: number;
  bas: number;
  haut: number;
  /**
   * plein : toute la hauteur (trumeau, retour d'angle) ; allege : sous une
   * fenêtre ; linteau : au-dessus d'une ouverture ; entre-deux : entre deux
   * ouvertures superposées.
   */
  nature: NatureMorceau;
}

export interface GrilleMur {
  /** Bornes des colonnes le long du côté (cm), croissantes. */
  colonnes: number[];
  /** Bornes des bandes en hauteur (cm), croissantes, de 0 à la hauteur du mur. */
  bandes: number[];
  /** plein[colonne][bande] */
  plein: boolean[][];
}

/** En deçà (cm), deux bornes sont confondues : évite les lamelles de mur invisibles. */
export const TOLERANCE_MUR = 0.1;

/** Bornes triées, dédoublonnées, ramenées dans [min, max] ; min et max sont toujours présentes. */
function bornes(valeurs: readonly number[], min: number, max: number): number[] {
  const interieures = valeurs
    .filter((v) => Number.isFinite(v) && v > min + TOLERANCE_MUR && v < max - TOLERANCE_MUR)
    .sort((a, b) => a - b);
  const res = [min];
  for (const v of interieures) if (v - res[res.length - 1] > TOLERANCE_MUR) res.push(v);
  res.push(max);
  return res;
}

/** Percement ramené dans le côté [0, longueur] et la hauteur [0, hauteur] ; null s'il ne perce rien. */
function borner(p: Percement, longueur: number, hauteur: number) {
  const s0 = Math.max(0, Math.min(longueur, p.debut));
  const s1 = Math.max(0, Math.min(longueur, p.debut + p.largeur));
  const z0 = Math.max(0, Math.min(hauteur, p.allege));
  const z1 = Math.max(0, Math.min(hauteur, p.allege + p.hauteur));
  if (s1 - s0 <= TOLERANCE_MUR || z1 - z0 <= TOLERANCE_MUR) return null;
  return { s0, s1, z0, z1 };
}

/**
 * Quadrillage d'un côté de mur.
 * @param debutMur abscisse de départ du mur (≤ 0 : l'onglet peut déborder du côté intérieur)
 * @param finMur abscisse de fin du mur (≥ longueur)
 * @param longueur longueur du côté intérieur (les ouvertures y sont bornées)
 * @param hauteur hauteur du mur
 */
export function grilleMur(
  debutMur: number,
  finMur: number,
  longueur: number,
  hauteur: number,
  percements: readonly Percement[],
): GrilleMur {
  const ouvertures = percements
    .map((p) => borner(p, longueur, hauteur))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const debut = Math.min(debutMur, 0);
  const fin = Math.max(finMur, longueur);
  const colonnes = bornes([0, longueur, ...ouvertures.flatMap((o) => [o.s0, o.s1])], debut, fin);
  const bandes = bornes(ouvertures.flatMap((o) => [o.z0, o.z1]), 0, Math.max(hauteur, 0));
  const plein = colonnes.slice(0, -1).map((s, c) => {
    const sc = (s + colonnes[c + 1]) / 2;
    return bandes.slice(0, -1).map((z, b) => {
      const zc = (z + bandes[b + 1]) / 2;
      return !ouvertures.some((o) => o.s0 < sc && sc < o.s1 && o.z0 < zc && zc < o.z1);
    });
  });
  return { colonnes, bandes, plein };
}

/**
 * Morceaux pleins d'un côté de mur : les cellules pleines de chaque colonne
 * sont regroupées en hauteur, puis les colonnes voisines identiques sont
 * fusionnées. Ex. une fenêtre au milieu d'un mur donne deux trumeaux (plein),
 * une allège et un linteau.
 */
export function decouperMur(
  debutMur: number,
  finMur: number,
  longueur: number,
  hauteur: number,
  percements: readonly Percement[],
): MorceauMur[] {
  const g = grilleMur(debutMur, finMur, longueur, hauteur, percements);
  const h = g.bandes[g.bandes.length - 1];
  // Tranches pleines (bas, haut) de chaque colonne.
  const tranches = g.plein.map((colonne) => {
    const res: Array<[number, number]> = [];
    colonne.forEach((plein, b) => {
      if (!plein) return;
      const dernier = res[res.length - 1];
      if (dernier && dernier[1] === g.bandes[b]) dernier[1] = g.bandes[b + 1];
      else res.push([g.bandes[b], g.bandes[b + 1]]);
    });
    return res;
  });
  const identiques = (a: Array<[number, number]>, b: Array<[number, number]>) =>
    a.length === b.length && a.every((x, i) => x[0] === b[i][0] && x[1] === b[i][1]);
  const morceaux: MorceauMur[] = [];
  let c = 0;
  while (c < tranches.length) {
    let c2 = c;
    while (c2 + 1 < tranches.length && identiques(tranches[c2 + 1], tranches[c])) c2++;
    for (const [bas, haut] of tranches[c]) {
      const nature: NatureMorceau =
        bas === 0 && haut === h ? 'plein' : bas === 0 ? 'allege' : haut === h ? 'linteau' : 'entre-deux';
      morceaux.push({ debut: g.colonnes[c], fin: g.colonnes[c2 + 1], bas, haut, nature });
    }
    c = c2 + 1;
  }
  return morceaux;
}

// ─── Emprise d'une colonne de mur (vue de dessus) ───────────────────────────

/** Point de l'emprise, en repère local. `origine` : indice du sommet du trapèze d'origine (coordonnées exactes). */
export interface PointMur {
  s: number;
  t: number;
  origine?: number;
}

/**
 * Trapèze du mur en repère local, dans l'ordre : départ intérieur (0),
 * fin intérieure (1), fin extérieure (2), départ extérieur (3).
 */
export function trapezeMur(longueur: number, departExterieur: PointMur, finExterieure: PointMur): PointMur[] {
  return [
    { s: 0, t: 0, origine: 0 },
    { s: longueur, t: 0, origine: 1 },
    { s: finExterieure.s, t: finExterieure.t, origine: 2 },
    { s: departExterieur.s, t: departExterieur.t, origine: 3 },
  ];
}

/**
 * Partie du polygone (convexe) comprise entre les abscisses sMin et sMax
 * (Sutherland–Hodgman sur deux demi-plans). Les points de coupe reçoivent
 * exactement l'abscisse de la borne, pour que deux colonnes voisines aient des
 * sommets communs identiques.
 */
export function couperBande(poly: readonly PointMur[], sMin: number, sMax: number): PointMur[] {
  const couper = (entree: readonly PointMur[], borne: number, garderAuDessus: boolean): PointMur[] => {
    const dedans = (p: PointMur) => (garderAuDessus ? p.s >= borne - 1e-9 : p.s <= borne + 1e-9);
    const sortie: PointMur[] = [];
    for (let j = 0; j < entree.length; j++) {
      const courant = entree[j];
      const prec = entree[(j - 1 + entree.length) % entree.length];
      const cd = dedans(courant);
      if (cd !== dedans(prec)) {
        const f = (borne - prec.s) / (courant.s - prec.s);
        sortie.push({ s: borne, t: prec.t + (courant.t - prec.t) * f });
      }
      if (cd) sortie.push(courant);
    }
    return sortie;
  };
  return couper(couper(poly, sMin, true), sMax, false);
}

/** Aire signée (repère s, t) d'une emprise. */
export function aireMur(poly: readonly PointMur[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.s * q.t - q.s * p.t;
  }
  return a / 2;
}

/**
 * Nature d'un bord de l'emprise d'une colonne [sMin, sMax] :
 *  - interieur / exterieur : nu intérieur (t = 0) ou nu extérieur du mur ;
 *  - debut / fin : onglet de départ ou de fin du mur (jonction avec le mur voisin) ;
 *  - gauche / droite : coupe commune avec la colonne voisine.
 */
export type BordEmprise = 'interieur' | 'exterieur' | 'debut' | 'fin' | 'gauche' | 'droite';

function surDroite(p: PointMur, a: PointMur, b: PointMur): boolean {
  const ds = b.s - a.s;
  const dt = b.t - a.t;
  const l = Math.hypot(ds, dt);
  if (l < 1e-9) return Math.hypot(p.s - a.s, p.t - a.t) < 1e-6;
  return Math.abs((p.s - a.s) * dt - (p.t - a.t) * ds) / l < 1e-6;
}

export function classerBord(
  a: PointMur,
  b: PointMur,
  sMin: number,
  sMax: number,
  trapeze: readonly PointMur[],
): BordEmprise {
  const [p0, p1, q1, q0] = trapeze;
  if (Math.abs(a.t) < 1e-6 && Math.abs(b.t) < 1e-6) return 'interieur';
  if (surDroite(a, q0, q1) && surDroite(b, q0, q1)) return 'exterieur';
  if (surDroite(a, p0, q0) && surDroite(b, p0, q0)) return 'debut';
  if (surDroite(a, p1, q1) && surDroite(b, p1, q1)) return 'fin';
  if (Math.abs(a.s - sMin) < 1e-6 && Math.abs(b.s - sMin) < 1e-6) return 'gauche';
  if (Math.abs(a.s - sMax) < 1e-6 && Math.abs(b.s - sMax) < 1e-6) return 'droite';
  // Cas numérique imprévu : on garde la face (mieux vaut une face en trop qu'un trou).
  return 'exterieur';
}
