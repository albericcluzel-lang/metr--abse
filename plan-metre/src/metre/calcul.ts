// Moteur de métré.
//
// Règles (reprises de l'appli de référence, cf. docs/analyse-visuary.md) :
//  - Surface au sol      = aire du contour intérieur de la pièce.
//  - Murs et cloisons    = longueur de chaque côté portant un mur × hauteur
//                          sous plafond (surface brute, une face), par type de mur.
//  - À peindre           = murs bruts − ouvertures (si « déduire les ouvertures »,
//                          au-delà du seuil), + plafond si la pièce le demande.
//  - Volume              = surface au sol × hauteur.
//  - Périmètre intérieur = tour du contour intérieur.
//  - Périmètre extérieur = tour du contour décalé de l'épaisseur des murs.
//  - Plinthes            = longueur des côtés avec mur − largeur des ouvertures
//                          qui descendent au sol.
//  - Revêtement de sol   = surface au sol − emprise des équipements « déduits ».
//
// Une ouverture posée dans une pièce traverse le mur : elle est aussi déduite
// de la face du même mur dans la pièce voisine (détection automatique des
// côtés dos à dos), sans être comptée deux fois dans les menuiseries.
//
// Unités internes : cm, cm², cm³. Conversion en m / m² / m³ dans `lignesMetre`.

import { ouvertureAuSol, MODELES_OUVERTURES } from '../model/catalogue';
import type {
  Catalogue,
  ID,
  Niveau,
  ParametresMetre,
  Piece,
  Plan,
  Projet,
  TypeOuverture,
  Variante,
} from '../model/types';
import {
  contourExterieur,
  empriseDansPiece,
  epaisseurCote,
  hauteurEffective,
  segmentOuverture,
  trouverTypeMur,
  typeMurIdCote,
} from '../geometrie/piece';
import { aire, longueurCote, normaleExterieure, perimetre, suivant } from '../geometrie/polygone';

export interface DetailMetre {
  nombrePieces: number;
  /** cm² */
  surfaceSol: number;
  /** cm³ */
  volume: number;
  /** cm */
  perimetreInterieur: number;
  perimetreExterieur: number;
  plinthes: number;
  /** cm², par identifiant de type de mur. */
  mursBruts: Record<ID, number>;
  mursAPeindre: Record<ID, number>;
  /** cm² */
  plafondAPeindre: number;
  /** cm², par identifiant de revêtement ('' = non renseigné). */
  sols: Record<string, number>;
  /** Nombre d'ouvertures par modèle (clé : type|largeur|hauteur). */
  ouvertures: Record<string, number>;
}

export function detailVide(): DetailMetre {
  return {
    nombrePieces: 0,
    surfaceSol: 0,
    volume: 0,
    perimetreInterieur: 0,
    perimetreExterieur: 0,
    plinthes: 0,
    mursBruts: {},
    mursAPeindre: {},
    plafondAPeindre: 0,
    sols: {},
    ouvertures: {},
  };
}

/** Ouverture qui perce un côté de la pièce (la sienne ou celle d'une pièce voisine). */
export interface PercementCote {
  cote: number;
  /** Début du percement le long du côté (cm). */
  debut: number;
  /** Largeur sur ce côté (cm). */
  largeur: number;
  /** Hauteur dans le mur de cette pièce (cm). */
  hauteur: number;
  allege: number;
}

const COS_PARALLELE = Math.cos((3 * Math.PI) / 180);

/**
 * Ouvertures des autres pièces du plan qui traversent un mur de `piece`
 * (côtés dos à dos, séparés au plus de l'épaisseur du mur + 5 cm).
 */
export function percementsVoisins(piece: Piece, plan: Plan, catalogue: Catalogue): PercementCote[] {
  const resultat: PercementCote[] = [];
  if (piece.sommets.length < 3) return resultat;
  for (const autre of plan.pieces) {
    if (autre.id === piece.id || autre.sommets.length < 3) continue;
    for (const o of autre.ouvertures) {
      const seg = segmentOuverture(autre, o);
      if (!seg || seg.fin - seg.debut <= 0) continue;
      if (typeMurIdCote(autre, o.cote) === null) continue;
      const nA = normaleExterieure(autre.sommets, o.cote);
      const epaisseur = epaisseurCote(autre, o.cote, catalogue);
      const ua = { x: (seg.b.x - seg.a.x) / (seg.fin - seg.debut), y: (seg.b.y - seg.a.y) / (seg.fin - seg.debut) };
      for (let j = 0; j < piece.sommets.length; j++) {
        if (typeMurIdCote(piece, j) === null) continue;
        const p = piece.sommets[j];
        const q = suivant(piece.sommets, j);
        const l = longueurCote(piece.sommets, j);
        if (l <= 0) continue;
        const ub = { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
        if (Math.abs(ua.x * ub.x + ua.y * ub.y) < COS_PARALLELE) continue;
        const nB = normaleExterieure(piece.sommets, j);
        // Les deux faces du mur se regardent : normales opposées.
        if (nA.x * nB.x + nA.y * nB.y > -COS_PARALLELE) continue;
        // Écart entre la face de la pièce voisine et ce côté, mesuré selon nA.
        const ecart = (p.x - seg.a.x) * nA.x + (p.y - seg.a.y) * nA.y;
        if (ecart < -2 || ecart > Math.max(epaisseur, 1) + 5) continue;
        const sa = (seg.a.x - p.x) * ub.x + (seg.a.y - p.y) * ub.y;
        const sb = (seg.b.x - p.x) * ub.x + (seg.b.y - p.y) * ub.y;
        const debut = Math.max(0, Math.min(sa, sb));
        const fin = Math.min(l, Math.max(sa, sb));
        if (fin - debut <= 1) continue;
        const allege = Math.max(0, o.allege);
        const haut = Math.min(allege + o.hauteur, piece.hauteur);
        resultat.push({ cote: j, debut, largeur: fin - debut, hauteur: Math.max(0, haut - allege), allege });
      }
    }
  }
  return resultat;
}

/** Ouvertures propres de la pièce, sous forme de percements. */
export function percementsPropres(piece: Piece): PercementCote[] {
  const res: PercementCote[] = [];
  for (const o of piece.ouvertures) {
    const seg = segmentOuverture(piece, o);
    if (!seg) continue;
    res.push({
      cote: o.cote,
      debut: seg.debut,
      largeur: seg.fin - seg.debut,
      hauteur: hauteurEffective(piece, o),
      allege: Math.max(0, o.allege),
    });
  }
  return res;
}

function chevauchement(a: PercementCote, b: PercementCote): number {
  return Math.max(0, Math.min(a.debut + a.largeur, b.debut + b.largeur) - Math.max(a.debut, b.debut));
}

export function cleOuverture(type: TypeOuverture, largeur: number, hauteur: number): string {
  return `${type}|${Math.round(largeur)}|${Math.round(hauteur)}`;
}

/**
 * Métré d'une pièce. `plan` (facultatif) permet de tenir compte des
 * ouvertures des pièces voisines qui traversent ses murs.
 */
export function metrePiece(
  piece: Piece,
  catalogue: Catalogue,
  parametres: ParametresMetre,
  plan?: Plan,
): DetailMetre {
  const d = detailVide();
  if (piece.sommets.length < 3) return d;
  const sol = aire(piece.sommets);
  d.nombrePieces = 1;
  d.surfaceSol = sol;
  d.volume = sol * piece.hauteur;
  d.perimetreInterieur = perimetre(piece.sommets);
  d.perimetreExterieur = perimetre(contourExterieur(piece, catalogue));
  d.plafondAPeindre = piece.plafondAPeindre ? sol : 0;

  const propres = percementsPropres(piece);
  // Une ouverture saisie des deux côtés du mur n'est déduite qu'une fois.
  const voisins = (plan ? percementsVoisins(piece, plan, catalogue) : []).filter(
    (v) => !propres.some((p) => p.cote === v.cote && chevauchement(p, v) > 0.5 * Math.min(p.largeur, v.largeur)),
  );
  const percements = [...propres, ...voisins];
  const seuilCm2 = Math.max(0, parametres.seuilDeductionOuverture) * 10000;

  for (let i = 0; i < piece.sommets.length; i++) {
    const typeId = typeMurIdCote(piece, i);
    if (typeId === null) continue;
    const l = longueurCote(piece.sommets, i);
    const brut = l * piece.hauteur;
    let deduit = 0;
    let largeurAuSol = 0;
    for (const pc of percements) {
      if (pc.cote !== i) continue;
      const s = pc.largeur * pc.hauteur;
      if (parametres.deduireOuvertures && s > seuilCm2) deduit += s;
      if (ouvertureAuSol(pc.allege)) largeurAuSol += pc.largeur;
    }
    d.mursBruts[typeId] = (d.mursBruts[typeId] ?? 0) + brut;
    d.mursAPeindre[typeId] = (d.mursAPeindre[typeId] ?? 0) + Math.max(0, brut - deduit);
    d.plinthes += Math.max(0, l - largeurAuSol);
  }

  let emprise = 0;
  for (const e of piece.equipements) {
    if (e.deduireSol) emprise += empriseDansPiece(piece, e);
  }
  d.sols[piece.revetementSolId ?? ''] = Math.max(0, sol - emprise);

  for (const o of piece.ouvertures) {
    const k = cleOuverture(o.type, o.largeur, o.hauteur);
    d.ouvertures[k] = (d.ouvertures[k] ?? 0) + 1;
  }
  return d;
}

function ajouterRecord(cible: Record<string, number>, source: Record<string, number>) {
  for (const [k, v] of Object.entries(source)) cible[k] = (cible[k] ?? 0) + v;
}

export function additionner(details: readonly DetailMetre[]): DetailMetre {
  const t = detailVide();
  for (const d of details) {
    t.nombrePieces += d.nombrePieces;
    t.surfaceSol += d.surfaceSol;
    t.volume += d.volume;
    t.perimetreInterieur += d.perimetreInterieur;
    t.perimetreExterieur += d.perimetreExterieur;
    t.plinthes += d.plinthes;
    t.plafondAPeindre += d.plafondAPeindre;
    ajouterRecord(t.mursBruts, d.mursBruts);
    ajouterRecord(t.mursAPeindre, d.mursAPeindre);
    ajouterRecord(t.sols, d.sols);
    ajouterRecord(t.ouvertures, d.ouvertures);
  }
  return t;
}

/** Plan d'un niveau pour une variante. Sans plan rénové, le niveau est réputé inchangé. */
export function planDuNiveau(niveau: Niveau, variante: Variante): Plan {
  return variante === 'renove' ? (niveau.renove ?? niveau.actuel) : niveau.actuel;
}

export interface MetrePieceResultat {
  niveauId: ID;
  niveauNom: string;
  pieceId: ID;
  pieceNom: string;
  detail: DetailMetre;
}

export interface MetreNiveauResultat {
  niveauId: ID;
  niveauNom: string;
  detail: DetailMetre;
}

export interface MetreProjet {
  global: DetailMetre;
  parNiveau: MetreNiveauResultat[];
  parPiece: MetrePieceResultat[];
}

export function metreProjet(projet: Projet, variante: Variante): MetreProjet {
  const parPiece: MetrePieceResultat[] = [];
  const parNiveau: MetreNiveauResultat[] = [];
  const niveaux = [...projet.niveaux].sort((a, b) => a.ordre - b.ordre);
  for (const niveau of niveaux) {
    const plan = planDuNiveau(niveau, variante);
    const details = plan.pieces.map((p) => {
      const detail = metrePiece(p, projet.catalogue, projet.parametres, plan);
      parPiece.push({ niveauId: niveau.id, niveauNom: niveau.nom, pieceId: p.id, pieceNom: p.nom, detail });
      return detail;
    });
    parNiveau.push({ niveauId: niveau.id, niveauNom: niveau.nom, detail: additionner(details) });
  }
  return { global: additionner(parNiveau.map((n) => n.detail)), parNiveau, parPiece };
}

// ─── Présentation ──────────────────────────────────────────────────────────

export type SectionMetre = 'surfaces' | 'murs' | 'peinture' | 'volume' | 'perimetres' | 'sols' | 'ouvertures';
export type UniteMetre = 'm²' | 'm³' | 'm' | 'u';

export interface LigneMetre {
  /** Clé stable (pour comparer deux métrés). */
  cle: string;
  section: SectionMetre;
  libelle: string;
  /** Précision affichée sous le libellé (ex. nom du revêtement). */
  precision?: string;
  valeur: number;
  unite: UniteMetre;
}

export interface DefinitionSection {
  id: SectionMetre;
  titre: string;
}

export const SECTIONS_METRE: DefinitionSection[] = [
  { id: 'surfaces', titre: 'Surfaces' },
  { id: 'murs', titre: 'Surfaces murs et cloisons' },
  { id: 'peinture', titre: 'Surfaces à peindre' },
  { id: 'volume', titre: 'Volume' },
  { id: 'perimetres', titre: 'Circonférences' },
  { id: 'sols', titre: 'Revêtements de sol' },
  { id: 'ouvertures', titre: 'Menuiseries et ouvertures' },
];

function nomTypeMur(catalogue: Catalogue, id: ID): string {
  return trouverTypeMur(catalogue, id)?.nom ?? 'Type de mur supprimé';
}

/** Lignes affichables d'un métré, dans l'ordre des sections. Valeurs en m, m², m³. */
export function lignesMetre(d: DetailMetre, catalogue: Catalogue): LigneMetre[] {
  const lignes: LigneMetre[] = [];
  lignes.push({ cle: 'surfaces:sol', section: 'surfaces', libelle: 'Surface au sol', valeur: d.surfaceSol / 1e4, unite: 'm²' });

  const ordreMurs = (ids: string[]) =>
    ids.sort((a, b) => {
      const ia = catalogue.typesMurs.findIndex((t) => t.id === a);
      const ib = catalogue.typesMurs.findIndex((t) => t.id === b);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });

  for (const id of ordreMurs(Object.keys(d.mursBruts))) {
    lignes.push({ cle: `murs:${id}`, section: 'murs', libelle: nomTypeMur(catalogue, id), valeur: d.mursBruts[id] / 1e4, unite: 'm²' });
  }
  for (const id of ordreMurs(Object.keys(d.mursAPeindre))) {
    lignes.push({ cle: `peinture:${id}`, section: 'peinture', libelle: nomTypeMur(catalogue, id), valeur: d.mursAPeindre[id] / 1e4, unite: 'm²' });
  }
  if (d.nombrePieces > 0) {
    lignes.push({ cle: 'peinture:plafond', section: 'peinture', libelle: 'Plafond', valeur: d.plafondAPeindre / 1e4, unite: 'm²' });
    lignes.push({ cle: 'volume', section: 'volume', libelle: 'Volume', valeur: d.volume / 1e6, unite: 'm³' });
    lignes.push({ cle: 'perimetres:exterieur', section: 'perimetres', libelle: 'Extérieure', valeur: d.perimetreExterieur / 100, unite: 'm' });
    lignes.push({ cle: 'perimetres:interieur', section: 'perimetres', libelle: 'Intérieure', valeur: d.perimetreInterieur / 100, unite: 'm' });
    lignes.push({ cle: 'perimetres:plinthes', section: 'perimetres', libelle: 'Plinthes', valeur: d.plinthes / 100, unite: 'm' });
  }

  const ordreSols = Object.keys(d.sols).sort((a, b) => {
    const ia = a === '' ? 1e9 : catalogue.revetementsSol.findIndex((r) => r.id === a);
    const ib = b === '' ? 1e9 : catalogue.revetementsSol.findIndex((r) => r.id === b);
    return ia - ib;
  });
  for (const id of ordreSols) {
    const rev = catalogue.revetementsSol.find((r) => r.id === id);
    lignes.push({
      cle: `sols:${id}`,
      section: 'sols',
      libelle: id === '' ? 'Non renseigné' : (rev?.nom ?? 'Revêtement supprimé'),
      valeur: d.sols[id] / 1e4,
      unite: 'm²',
    });
  }

  const ordreTypes = Object.keys(MODELES_OUVERTURES);
  const clesOuvertures = Object.keys(d.ouvertures).sort((a, b) => {
    const [ta, la, ha] = a.split('|');
    const [tb, lb, hb] = b.split('|');
    return ordreTypes.indexOf(ta) - ordreTypes.indexOf(tb) || Number(la) - Number(lb) || Number(ha) - Number(hb);
  });
  for (const k of clesOuvertures) {
    const [type, largeur, hauteur] = k.split('|');
    const modele = MODELES_OUVERTURES[type as TypeOuverture];
    lignes.push({
      cle: `ouvertures:${k}`,
      section: 'ouvertures',
      libelle: modele?.libelle ?? type,
      precision: `${largeur} × ${hauteur} cm`,
      valeur: d.ouvertures[k],
      unite: 'u',
    });
  }
  return lignes;
}

export interface LigneComparee {
  cle: string;
  section: SectionMetre;
  libelle: string;
  precision?: string;
  unite: UniteMetre;
  actuel: number;
  renove: number;
  ecart: number;
}

/** Met en regard deux métrés (plan actuel / plan rénové), ligne à ligne. */
export function comparerLignes(actuel: readonly LigneMetre[], renove: readonly LigneMetre[]): LigneComparee[] {
  const ordreSection = new Map(SECTIONS_METRE.map((s, i) => [s.id, i]));
  const parCle = new Map<string, LigneComparee>();
  const ordre: string[] = [];
  const ajouter = (l: LigneMetre, cote: 'actuel' | 'renove') => {
    let c = parCle.get(l.cle);
    if (!c) {
      c = { cle: l.cle, section: l.section, libelle: l.libelle, precision: l.precision, unite: l.unite, actuel: 0, renove: 0, ecart: 0 };
      parCle.set(l.cle, c);
      ordre.push(l.cle);
    }
    c[cote] = l.valeur;
  };
  actuel.forEach((l) => ajouter(l, 'actuel'));
  renove.forEach((l) => ajouter(l, 'renove'));
  const res = ordre.map((k) => {
    const c = parCle.get(k)!;
    c.ecart = c.renove - c.actuel;
    return c;
  });
  // Tri stable par section (les lignes propres au plan rénové rejoignent leur section).
  return res
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (ordreSection.get(a.c.section)! - ordreSection.get(b.c.section)!) || a.i - b.i)
    .map((x) => x.c);
}

/** Arrondi décimal exact (8,925 → 8,93), sans les pièges de la virgule flottante. */
export function arrondir(v: number, decimales = 2): number {
  if (!Number.isFinite(v)) return 0;
  const signe = v < 0 ? -1 : 1;
  const r = Number(`${Math.round(Number(`${Math.abs(v)}e${decimales}`))}e-${decimales}`);
  return signe * r;
}

const FORMAT_DECIMAL = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FORMAT_ENTIER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** « 3,57 m² », « 2 u ». */
export function formaterValeur(v: number, unite: UniteMetre): string {
  if (unite === 'u') return `${FORMAT_ENTIER.format(Math.round(v))} u`;
  return `${FORMAT_DECIMAL.format(arrondir(v, 2))} ${unite}`;
}

/** Écart signé : « +1,20 m² », « −0,40 m », « = ». */
export function formaterEcart(v: number, unite: UniteMetre): string {
  const r = unite === 'u' ? Math.round(v) : arrondir(v, 2);
  if (r === 0) return '=';
  const txt = formaterValeur(Math.abs(r), unite);
  return `${r > 0 ? '+' : '−'}${txt}`;
}
