// Éditeur de plan 2D : rendu SVG du plan courant (pièces, murs, ouvertures,
// équipements, photos épinglées), outils de dessin et d'édition, panneau de
// propriétés de la sélection.
//
// Gestes : un doigt (ou la souris) sur le vide déplace la vue, deux doigts
// zooment autour de leur milieu, la molette zoome sous le curseur. Chaque
// glisser d'un objet ne fait qu'une étape d'annulation (clé unique par geste).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as EvenementPointeur,
} from 'react';
import { epaisseurCote } from '../../geometrie/piece';
import { aire, contientPoint, distance, longueurCote, normaleExterieure } from '../../geometrie/polygone';
import { MODELES_EQUIPEMENTS } from '../../model/catalogue';
import { nouvellePiece } from '../../model/fabrique';
import type { ID, Piece, Point, TypeEquipement, TypeOuverture } from '../../model/types';
import { niveauCourant, planCourant, useEtat } from '../../store/etat';
import { ajouterPhotoDepuisFichier } from '../../store/images';
import { notifier } from '../commun/dialogues';
import { naviguer } from '../routeur';
import { couperCote, modifierPiece, pieceDuPlan, supprimerSelection } from './actions';
import { aimanterMurAMur, aimanterPointDessin, aimanterSommet, sommetsAimantables, type Aimant } from './aimantation';
import {
  CalquePhotos,
  CalquePlan,
  CalquePoignees,
  CalqueTextes,
  CalqueTrace,
  COTE_MIN_MILIEU_PX,
  EPINGLE_TETE_PX,
  EPINGLE_TOUCHE_PX,
  Grille,
  pieceActive,
  TOUCHE_MILIEU_PX,
  TOUCHE_MILIEU_TACTILE_PX,
  TOUCHE_SOMMET_PX,
} from './Calques';
import { pointDeSelection } from './dessin';
import { Bandeau, BarreDessin, EtatVidePlan, Palette, type Outil } from './Commandes';
import { FormulaireNouvellePiece } from './FormulairePiece';
import {
  abscisseSurCote,
  bornerPosition,
  deplacerPiece,
  deplacerSommet,
  insererSommet,
  ouvertureSurCote,
  placerEquipement,
  seCroise,
  transfererEquipement,
} from './operations';
import { LIBELLES_OUVERTURES, PanneauProprietes, TYPES_EQUIPEMENTS, TYPES_OUVERTURES } from './Proprietes';
import {
  coteSousPoint,
  equipementSousPoint,
  ouvertureSousPoint,
  pieceSousPoint,
  poigneeProche,
  poigneesMilieux,
  sommetProche,
} from './touche';
import { ajusterVue, boitePlan, pincer, versEcran, versPlan, zoomer, type Marges, type Vue } from './vue';
import './plan2d.css';

/**
 * Zones occupées par les commandes flottantes, laissées libres par « Ajuster
 * la vue » (px). Sur grand écran, le plan est souvent limité par la hauteur :
 * on réserve aussi la place du bandeau des outils.
 */
const MARGES_VUE: Marges = { haut: 24, droite: 66, bas: 80, gauche: 74 };
const MARGES_VUE_LARGE: Marges = { ...MARGES_VUE, haut: 80 };
/** Déplacement (px) au-delà duquel un appui devient un glisser. */
const SEUIL_GLISSER_SOURIS = 4;
const SEUIL_GLISSER_TACTILE = 8;
/** Rayon d'aimantation sur les sommets (px écran). */
const AIMANT_PX = 12;
const FACTEUR_ZOOM = 1.4;

/** Ce qui se trouve sous le pointeur au début d'un geste (outil Sélection). */
type Cible =
  | { type: 'vide' }
  | { type: 'sommet'; pieceId: ID; index: number }
  | { type: 'milieu'; pieceId: ID; index: number }
  | { type: 'photo'; photoId: ID }
  | { type: 'ouverture'; pieceId: ID; ouvertureId: ID; abscisse: number }
  | { type: 'equipement'; pieceId: ID; equipementId: ID }
  | { type: 'cote'; pieceId: ID; index: number }
  | { type: 'interieur'; pieceId: ID };

/** Ce que fait le geste quand le pointeur se déplace. */
type Glisser =
  | { mode: 'vue'; vueDepart: Vue }
  | { mode: 'trace' }
  | { mode: 'sommet'; pieceId: ID; index: number; pieceDepart: Piece; cibles: Point[] }
  | { mode: 'milieu'; pieceId: ID; index: number; pieceDepart: Piece; cibles: Point[] }
  | { mode: 'piece'; pieceId: ID; pieceDepart: Piece; autres: Piece[] }
  | { mode: 'ouverture'; pieceId: ID; ouvertureId: ID; decalage: number }
  | { mode: 'equipement'; pieceId: ID; equipementId: ID; centreDepart: Point };

interface Geste {
  pointerId: number;
  departEcran: Point;
  departPlan: Point;
  tactile: boolean;
  /** Le pointeur a assez bougé : ce n'est plus un simple toucher. */
  bouge: boolean;
  outil: Outil;
  cible: Cible;
  glisser: Glisser;
  /** Clé d'annulation propre à ce geste. */
  cle: string;
}

interface Pince {
  ids: [number, number];
  a0: Point;
  b0: Point;
  vueDepart: Vue;
}

/** Distance (cm) de `p` au nu intérieur du côté i, positive vers l'extérieur. */
function abscisseNormale(piece: Piece, i: number, p: Point): number {
  const a = piece.sommets[i];
  const n = normaleExterieure(piece.sommets, i);
  return (p.x - a.x) * n.x + (p.y - a.y) * n.y;
}

function useRequeteMedia(requete: string): boolean {
  const [ok, setOk] = useState(() => typeof window !== 'undefined' && window.matchMedia(requete).matches);
  useEffect(() => {
    const mq = window.matchMedia(requete);
    const maj = () => setOk(mq.matches);
    maj();
    mq.addEventListener('change', maj);
    return () => mq.removeEventListener('change', maj);
  }, [requete]);
  return ok;
}

let compteurGestes = 0;

export function EditeurPlan2D() {
  const projet = useEtat((e) => e.projet);
  const niveauId = useEtat((e) => e.niveauId);
  const variante = useEtat((e) => e.variante);
  const selection = useEtat((e) => e.selection);
  const photos = useEtat((e) => e.photos);
  const niveau = projet ? niveauCourant({ projet, niveauId }) : null;
  const plan = projet ? planCourant({ projet, niveauId, variante }) : null;
  const catalogue = projet?.catalogue ?? null;
  const large = useRequeteMedia('(min-width: 900px)');

  const racineRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const entreePhotoRef = useRef<HTMLInputElement>(null);

  const [taille, setTaille] = useState<{ largeur: number; hauteur: number } | null>(null);
  const tailleRef = useRef(taille);
  const [vue, setVue] = useState<Vue>({ echelle: 1, tx: 0, ty: 0 });
  const vueRef = useRef(vue);
  const [outil, setOutil] = useState<Outil>('selection');
  const [typeOuverture, setTypeOuverture] = useState<TypeOuverture>('porte');
  const [typeEquipement, setTypeEquipement] = useState<TypeEquipement>('baignoire');
  const [trace, setTrace] = useState<Point[]>([]);
  const traceRef = useRef(trace);
  const [curseur, setCurseur] = useState<Aimant | null>(null);
  const [formulaire, setFormulaire] = useState(false);

  const geste = useRef<Geste | null>(null);
  const pince = useRef<Pince | null>(null);
  const pointeurs = useRef(new Map<number, Point>());
  const photoEnAttente = useRef<{ position: Point; pieceId: ID | null } | null>(null);
  const cacheCibles = useRef<{ plan: unknown; cibles: Point[] }>({ plan: null, cibles: [] });

  // Valeurs courantes lues par les gestionnaires d'évènements natifs.
  const courant = useRef({ outil, typeOuverture, typeEquipement, formulaire });
  courant.current = { outil, typeOuverture, typeEquipement, formulaire };

  const definirVue = useCallback((v: Vue) => {
    vueRef.current = v;
    setVue(v);
  }, []);

  const definirTrace = useCallback((t: Point[]) => {
    traceRef.current = t;
    setTrace(t);
  }, []);

  const changerOutil = useCallback(
    (o: Outil) => {
      setOutil(o);
      definirTrace([]);
      setCurseur(null);
      setFormulaire(false);
      if (o !== 'selection') useEtat.getState().selectionner(null);
    },
    [definirTrace],
  );

  const photosNiveau = useMemo(
    () => photos.filter((ph) => ph.position && ph.niveauId === niveau?.id),
    [photos, niveau?.id],
  );

  // ─── Taille, ajustement de la vue, molette ─────────────────────────────

  useEffect(() => {
    const el = racineRef.current;
    if (!el) return;
    const mesurer = () => {
      const r = el.getBoundingClientRect();
      const t = { largeur: Math.round(r.width), hauteur: Math.round(r.height) };
      if (t.largeur <= 0 || t.hauteur <= 0) return;
      tailleRef.current = t;
      setTaille((avant) => (avant && avant.largeur === t.largeur && avant.hauteur === t.hauteur ? avant : t));
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ajuster = useCallback(() => {
    const t = tailleRef.current;
    const e = useEtat.getState();
    if (!t || !e.projet) return;
    const pl = planCourant(e);
    const niv = niveauCourant(e);
    const epingles = e.photos.filter((ph) => ph.position && ph.niveauId === niv?.id).map((ph) => ph.position!);
    const boite = pl ? boitePlan(pl, e.projet.catalogue, epingles) : null;
    definirVue(ajusterVue(boite, t.largeur, t.hauteur, t.largeur >= 900 ? MARGES_VUE_LARGE : MARGES_VUE));
  }, [definirVue]);

  // Ajuster à l'ouverture et à chaque changement de niveau.
  const niveauAjuste = useRef<ID | null>(null);
  useEffect(() => {
    if (!taille || !niveau) return;
    if (niveauAjuste.current === niveau.id) return;
    niveauAjuste.current = niveau.id;
    ajuster();
  }, [taille, niveau, ajuster]);

  // Changement de niveau ou de variante : le tracé en cours est abandonné.
  useEffect(() => {
    definirTrace([]);
    setCurseur(null);
    setFormulaire(false);
  }, [niveau?.id, variante, definirTrace]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const surMolette = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // Pincer sur un pavé tactile = molette avec Ctrl : plus sensible.
      const facteur = Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0015));
      definirVue(zoomer(vueRef.current, facteur, { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    svg.addEventListener('wheel', surMolette, { passive: false });
    return () => svg.removeEventListener('wheel', surMolette);
  }, [definirVue]);

  // Sur téléphone, la feuille de propriétés couvre le bas de l'écran : si la
  // sélection passe dessous, on remonte le plan pour la garder visible.
  useEffect(() => {
    if (large || !selection || outil !== 'selection') return;
    const id = requestAnimationFrame(() => {
      const feuille = document.querySelector('.feuille');
      const svg = svgRef.current;
      const e = useEtat.getState();
      const pl = planCourant(e);
      // Jamais pendant un glisser : la vue bougerait sous le doigt.
      if (!feuille || !svg || !pl || !e.selection || geste.current || pince.current) return;
      const p = pointDeSelection(e.selection, pl, e.photos);
      if (!p) return;
      // La feuille arrive en glissant de 30 px : on compte large.
      const limite = feuille.getBoundingClientRect().top - svg.getBoundingClientRect().top - 40;
      const v = vueRef.current;
      const s = versEcran(v, p);
      if (s.y <= limite) return;
      definirVue({ ...v, ty: v.ty - (s.y - Math.max(70, limite * 0.5)) });
    });
    return () => cancelAnimationFrame(id);
  }, [selection, large, outil, definirVue]);

  const zoomerAuCentre = (facteur: number) => {
    const t = tailleRef.current;
    if (!t) return;
    definirVue(zoomer(vueRef.current, facteur, { x: t.largeur / 2, y: t.hauteur / 2 }));
  };

  // ─── Outils de dessin ─────────────────────────────────────────────────

  function ciblesAimant(): Point[] {
    const e = useEtat.getState();
    const pl = planCourant(e);
    if (!pl || !e.projet) return [];
    if (cacheCibles.current.plan !== pl) {
      cacheCibles.current = { plan: pl, cibles: sommetsAimantables(pl.pieces, e.projet.catalogue) };
    }
    return cacheCibles.current.cibles;
  }

  function calculerCurseur(pE: Point): Aimant {
    const v = vueRef.current;
    return aimanterPointDessin(versPlan(v, pE), traceRef.current, {
      cibles: ciblesAimant(),
      toleranceCm: AIMANT_PX / v.echelle,
    });
  }

  function retirerDernierPoint() {
    definirTrace(traceRef.current.slice(0, -1));
    setCurseur(null);
  }

  function terminerTrace() {
    const t = traceRef.current;
    if (t.length < 3) {
      notifier('Placez au moins 3 angles pour fermer la pièce');
      return;
    }
    if (aire(t) < 1000) {
      notifier('Pièce trop petite (moins de 0,1 m²)', { erreur: true });
      return;
    }
    if (seCroise(t)) {
      notifier('Les côtés du tracé se croisent : annulez le dernier point', { erreur: true });
      return;
    }
    setCurseur(null);
    setFormulaire(true);
  }

  function poserPointTrace(pE: Point, souris: boolean) {
    const a = calculerCurseur(pE);
    if (a.ferme) {
      terminerTrace();
      return;
    }
    const t = traceRef.current;
    const dernier = t[t.length - 1];
    if (dernier && distance(dernier, a.point) < 1) return;
    definirTrace([...t, a.point]);
    setCurseur(souris ? calculerCurseur(pE) : null);
  }

  function creerPiece(nom: string, hauteur: number) {
    const piece = nouvellePiece(nom, traceRef.current, { hauteur });
    useEtat.getState().modifierPlan((pl) => {
      pl.pieces.push(piece);
    });
    changerOutil('selection');
    useEtat.getState().selectionner({ type: 'piece', pieceId: piece.id });
  }

  function poserOuverture(pp: Point, tactile: boolean) {
    const e = useEtat.getState();
    const pl = planCourant(e);
    if (!pl || !e.projet) return;
    const t = coteSousPoint(pl, e.projet.catalogue, pp, (tactile ? 18 : 12) / vueRef.current.echelle);
    const piece = t && pl.pieces.find((p) => p.id === t.pieceId);
    if (!t || !piece) {
      notifier('Touchez un mur pour y poser l’ouverture');
      return;
    }
    const o = ouvertureSurCote(piece, courant.current.typeOuverture, t.index, t.abscisse);
    modifierPiece(piece.id, (p) => void p.ouvertures.push(o));
    changerOutil('selection');
    e.selectionner({ type: 'ouverture', pieceId: piece.id, ouvertureId: o.id });
  }

  function poserEquipement(pp: Point) {
    const e = useEtat.getState();
    const pl = planCourant(e);
    const piece = pl ? pieceSousPoint(pl, pp) : null;
    if (!piece) {
      notifier('Touchez l’intérieur d’une pièce');
      return;
    }
    const eq = placerEquipement(piece, courant.current.typeEquipement, pp);
    modifierPiece(piece.id, (p) => void p.equipements.push(eq));
    changerOutil('selection');
    e.selectionner({ type: 'equipement', pieceId: piece.id, equipementId: eq.id });
  }

  function demanderPhoto(pp: Point) {
    const pl = planCourant(useEtat.getState());
    photoEnAttente.current = {
      position: { x: Math.round(pp.x), y: Math.round(pp.y) },
      pieceId: pl ? (pieceSousPoint(pl, pp)?.id ?? null) : null,
    };
    entreePhotoRef.current?.click();
  }

  async function surFichierPhoto(e: ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    const contexte = photoEnAttente.current;
    photoEnAttente.current = null;
    if (!fichier || !contexte) return;
    const niv = niveauCourant(useEtat.getState());
    try {
      const photo = await ajouterPhotoDepuisFichier(fichier, {
        niveauId: niv?.id ?? null,
        pieceId: contexte.pieceId,
        position: contexte.position,
      });
      changerOutil('selection');
      useEtat.getState().selectionner({ type: 'photo', photoId: photo.id });
      notifier('Photo ajoutée au plan');
    } catch (err) {
      console.error('Photo non ajoutée', err);
      notifier('Impossible d’ajouter cette photo', { erreur: true });
    }
  }

  // ─── Gestes ──────────────────────────────────────────────────────────

  function pointEcran(e: { clientX: number; clientY: number }): Point {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function cibleSelection(pE: Point, tactile: boolean): Cible {
    const e = useEtat.getState();
    const pl = planCourant(e);
    const cat = e.projet?.catalogue;
    if (!pl || !cat) return { type: 'vide' };
    const v = vueRef.current;
    const k = 1 / v.echelle; // cm par px
    const f = tactile ? 1.5 : 1;
    const pp = versPlan(v, pE);
    const idActif = pieceActive(e.selection);
    const active = idActif ? pl.pieces.find((p) => p.id === idActif) : undefined;
    if (active) {
      const i = sommetProche(active.sommets, pp, TOUCHE_SOMMET_PX * k * (tactile ? 1.2 : 1));
      if (i >= 0) return { type: 'sommet', pieceId: active.id, index: i };
      const milieux = poigneesMilieux(active, cat, (q) => versEcran(v, q), v.echelle, COTE_MIN_MILIEU_PX);
      const j = poigneeProche(milieux, pE, tactile ? TOUCHE_MILIEU_TACTILE_PX : TOUCHE_MILIEU_PX);
      // Un toucher dans l'épaisseur du mur (ou en deçà) vise le côté, pas la poignée.
      if (j >= 0 && abscisseNormale(active, j, pp) * v.echelle > epaisseurCote(active, j, cat) * v.echelle + 4) {
        return { type: 'milieu', pieceId: active.id, index: j };
      }
    }
    const niv = niveauCourant(e);
    for (let n = e.photos.length - 1; n >= 0; n--) {
      const ph = e.photos[n];
      if (!ph.position || ph.niveauId !== niv?.id) continue;
      const s = versEcran(v, ph.position);
      if (distance(pE, { x: s.x, y: s.y - EPINGLE_TETE_PX }) <= EPINGLE_TOUCHE_PX * (tactile ? 1.2 : 1)) {
        return { type: 'photo', photoId: ph.id };
      }
    }
    const o = ouvertureSousPoint(pl, cat, pp, 8 * k * f, idActif);
    if (o) return { type: 'ouverture', pieceId: o.pieceId, ouvertureId: o.ouvertureId, abscisse: o.abscisse };
    const eq = equipementSousPoint(pl, pp, 3 * k * f);
    if (eq) return { type: 'equipement', ...eq };
    const c = coteSousPoint(pl, cat, pp, 10 * k * f, idActif);
    if (c) return { type: 'cote', pieceId: c.pieceId, index: c.index };
    const p = pieceSousPoint(pl, pp);
    if (p) return { type: 'interieur', pieceId: p.id };
    return { type: 'vide' };
  }

  /** Ce que fera un glisser commencé sur `cible` : déplacer l'objet si sa pièce est sélectionnée, sinon la vue. */
  function glisserPour(cible: Cible, v: Vue): Glisser {
    const e = useEtat.getState();
    const pl = planCourant(e);
    const cat = e.projet?.catalogue;
    const idActif = pieceActive(e.selection);
    const piece = 'pieceId' in cible ? pl?.pieces.find((p) => p.id === cible.pieceId) : undefined;
    if (pl && cat && piece) {
      switch (cible.type) {
        case 'sommet':
        case 'milieu':
          return {
            mode: cible.type,
            pieceId: piece.id,
            index: cible.index,
            pieceDepart: piece,
            cibles: sommetsAimantables(pl.pieces, cat, piece.id),
          };
        case 'ouverture': {
          const o = piece.ouvertures.find((x) => x.id === cible.ouvertureId);
          if (o && piece.id === idActif) {
            return { mode: 'ouverture', pieceId: piece.id, ouvertureId: o.id, decalage: cible.abscisse - o.position };
          }
          break;
        }
        case 'equipement': {
          const eq = piece.equipements.find((x) => x.id === cible.equipementId);
          if (eq && piece.id === idActif) {
            return { mode: 'equipement', pieceId: piece.id, equipementId: eq.id, centreDepart: { x: eq.x, y: eq.y } };
          }
          break;
        }
        case 'cote':
        case 'interieur':
          if (piece.id === idActif) {
            return { mode: 'piece', pieceId: piece.id, pieceDepart: piece, autres: pl.pieces.filter((p) => p.id !== piece.id) };
          }
          break;
      }
    }
    return { mode: 'vue', vueDepart: v };
  }

  function surPointerDown(e: EvenementPointeur<SVGSVGElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    if (courant.current.formulaire) return;
    // Un champ du panneau en cours de saisie est validé avant de toucher le plan.
    const focus = document.activeElement;
    if (focus instanceof HTMLElement && focus !== document.body) focus.blur();
    const pE = pointEcran(e);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointeur déjà relâché : sans conséquence.
    }
    // Premier doigt d'un nouveau geste : on oublie un éventuel pointeur dont le
    // relâchement aurait été perdu (sinon le prochain toucher deviendrait un pincement).
    if (e.isPrimary) {
      pointeurs.current.clear();
      pince.current = null;
    }
    pointeurs.current.set(e.pointerId, pE);
    if (pointeurs.current.size === 2) {
      // Second doigt : on abandonne le geste en cours (aucun point de tracé posé) et on pince.
      const ids = [...pointeurs.current.keys()] as [number, number];
      geste.current = null;
      pince.current = { ids, a0: pointeurs.current.get(ids[0])!, b0: pointeurs.current.get(ids[1])!, vueDepart: vueRef.current };
      if (courant.current.outil === 'dessin') setCurseur(null);
      return;
    }
    if (pointeurs.current.size > 2) return;
    const v = vueRef.current;
    const tactile = e.pointerType !== 'mouse';
    const outilCourant = courant.current.outil;
    const base = {
      pointerId: e.pointerId,
      departEcran: pE,
      departPlan: versPlan(v, pE),
      tactile,
      bouge: false,
      outil: outilCourant,
      cle: `plan2d-geste-${++compteurGestes}-${Date.now()}`,
    };
    if (e.button === 1) {
      geste.current = { ...base, bouge: true, cible: { type: 'vide' }, glisser: { mode: 'vue', vueDepart: v } };
      return;
    }
    if (outilCourant === 'dessin') {
      geste.current = { ...base, cible: { type: 'vide' }, glisser: { mode: 'trace' } };
      setCurseur(calculerCurseur(pE));
      return;
    }
    if (outilCourant === 'selection') {
      const cible = cibleSelection(pE, tactile);
      geste.current = { ...base, cible, glisser: glisserPour(cible, v) };
      return;
    }
    geste.current = { ...base, cible: { type: 'vide' }, glisser: { mode: 'vue', vueDepart: v } };
  }

  function appliquerGlisser(g: Geste, pE: Point) {
    const etat = useEtat.getState();
    const v = vueRef.current;
    const pp = versPlan(v, pE);
    const gl = g.glisser;
    switch (gl.mode) {
      case 'vue':
        definirVue({ ...gl.vueDepart, tx: gl.vueDepart.tx + pE.x - g.departEcran.x, ty: gl.vueDepart.ty + pE.y - g.departEcran.y });
        return;
      case 'trace':
        return;
      case 'milieu': {
        // Premier mouvement sur une poignée « + » : on coupe le côté, puis on glisse le nouveau sommet.
        const coupee = insererSommet(gl.pieceDepart, gl.index);
        if (coupee === gl.pieceDepart) {
          g.glisser = { mode: 'vue', vueDepart: v };
          return;
        }
        g.glisser = { mode: 'sommet', pieceId: gl.pieceId, index: gl.index + 1, pieceDepart: coupee, cibles: gl.cibles };
        appliquerGlisser(g, pE);
        return;
      }
      case 'sommet': {
        const a = aimanterSommet(pp, gl.pieceDepart.sommets, gl.index, gl.cibles, AIMANT_PX / v.echelle);
        const actuelle = pieceDuPlan(gl.pieceId);
        const s = actuelle?.sommets[gl.index];
        const dejaLa = s && actuelle.sommets.length === gl.pieceDepart.sommets.length && s.x === a.point.x && s.y === a.point.y;
        if (!dejaLa) modifierPiece(gl.pieceId, () => deplacerSommet(gl.pieceDepart, gl.index, a.point), { cle: g.cle });
        const sel = useEtat.getState().selection;
        if (!(sel?.type === 'sommet' && sel.pieceId === gl.pieceId && sel.index === gl.index)) {
          etat.selectionner({ type: 'sommet', pieceId: gl.pieceId, index: gl.index });
        }
        return;
      }
      case 'piece': {
        const cat = etat.projet?.catalogue;
        if (!cat) return;
        const dx = Math.round(pp.x - g.departPlan.x);
        const dy = Math.round(pp.y - g.departPlan.y);
        const c = aimanterMurAMur(deplacerPiece(gl.pieceDepart, dx, dy), gl.autres, cat);
        const finale = deplacerPiece(gl.pieceDepart, dx + c.x, dy + c.y);
        const actuelle = pieceDuPlan(gl.pieceId);
        if (actuelle && actuelle.sommets[0].x === finale.sommets[0].x && actuelle.sommets[0].y === finale.sommets[0].y) return;
        modifierPiece(gl.pieceId, () => finale, { cle: g.cle });
        return;
      }
      case 'ouverture': {
        const piece = pieceDuPlan(gl.pieceId);
        const o = piece?.ouvertures.find((x) => x.id === gl.ouvertureId);
        if (!piece || !o) return;
        const l = longueurCote(piece.sommets, o.cote);
        const position = bornerPosition(Math.round(abscisseSurCote(piece.sommets, o.cote, pp) - gl.decalage), o.largeur, l);
        if (position !== o.position) {
          modifierPiece(
            gl.pieceId,
            (p) => {
              const x = p.ouvertures.find((y) => y.id === gl.ouvertureId);
              if (x) x.position = position;
            },
            { cle: g.cle },
          );
        }
        const sel = useEtat.getState().selection;
        if (!(sel?.type === 'ouverture' && sel.ouvertureId === gl.ouvertureId)) {
          etat.selectionner({ type: 'ouverture', pieceId: gl.pieceId, ouvertureId: gl.ouvertureId });
        }
        return;
      }
      case 'equipement': {
        const x = Math.round(gl.centreDepart.x + pp.x - g.departPlan.x);
        const y = Math.round(gl.centreDepart.y + pp.y - g.departPlan.y);
        const eq = pieceDuPlan(gl.pieceId)?.equipements.find((q) => q.id === gl.equipementId);
        if (eq && (eq.x !== x || eq.y !== y)) {
          modifierPiece(
            gl.pieceId,
            (p) => {
              const q = p.equipements.find((z) => z.id === gl.equipementId);
              if (q) {
                q.x = x;
                q.y = y;
              }
            },
            { cle: g.cle },
          );
        }
        const sel = useEtat.getState().selection;
        if (!(sel?.type === 'equipement' && sel.equipementId === gl.equipementId)) {
          etat.selectionner({ type: 'equipement', pieceId: gl.pieceId, equipementId: gl.equipementId });
        }
        return;
      }
    }
  }

  /** Fin d'un glisser : un équipement lâché dans une autre pièce change de pièce. */
  function finirGlisser(g: Geste) {
    if (g.glisser.mode !== 'equipement') return;
    const { pieceId, equipementId } = g.glisser;
    const pl = planCourant(useEtat.getState());
    const source = pl?.pieces.find((p) => p.id === pieceId);
    const eq = source?.equipements.find((q) => q.id === equipementId);
    if (!pl || !source || !eq || contientPoint(source.sommets, eq)) return;
    const cible = pieceSousPoint(pl, eq);
    if (!cible || cible.id === source.id) return;
    useEtat.getState().modifierPlan(
      (plan) => {
        const i = plan.pieces.findIndex((p) => p.id === source.id);
        const j = plan.pieces.findIndex((p) => p.id === cible.id);
        if (i < 0 || j < 0) return;
        const r = transfererEquipement(plan.pieces[i], plan.pieces[j], equipementId);
        plan.pieces[i] = r.source;
        plan.pieces[j] = r.cible;
      },
      { cle: g.cle },
    );
    useEtat.getState().selectionner({ type: 'equipement', pieceId: cible.id, equipementId });
  }

  function toucher(g: Geste) {
    const { selectionner } = useEtat.getState();
    switch (g.outil) {
      case 'ouverture':
        poserOuverture(g.departPlan, g.tactile);
        return;
      case 'equipement':
        poserEquipement(g.departPlan);
        return;
      case 'photo':
        demanderPhoto(g.departPlan);
        return;
      case 'dessin':
        return;
      case 'selection':
        break;
    }
    const c = g.cible;
    switch (c.type) {
      case 'vide':
        selectionner(null);
        break;
      case 'sommet':
        selectionner({ type: 'sommet', pieceId: c.pieceId, index: c.index });
        break;
      case 'milieu':
        couperCote(c.pieceId, c.index);
        break;
      case 'photo':
        selectionner({ type: 'photo', photoId: c.photoId });
        break;
      case 'ouverture':
        selectionner({ type: 'ouverture', pieceId: c.pieceId, ouvertureId: c.ouvertureId });
        break;
      case 'equipement':
        selectionner({ type: 'equipement', pieceId: c.pieceId, equipementId: c.equipementId });
        break;
      case 'cote':
        selectionner({ type: 'cote', pieceId: c.pieceId, index: c.index });
        break;
      case 'interieur':
        selectionner({ type: 'piece', pieceId: c.pieceId });
        break;
    }
  }

  function surPointerMove(e: EvenementPointeur<SVGSVGElement>) {
    const pE = pointEcran(e);
    if (pointeurs.current.has(e.pointerId)) pointeurs.current.set(e.pointerId, pE);
    const pc = pince.current;
    if (pc) {
      const a = pointeurs.current.get(pc.ids[0]);
      const b = pointeurs.current.get(pc.ids[1]);
      if (a && b) definirVue(pincer(pc.vueDepart, pc.a0, pc.b0, a, b));
      return;
    }
    const g = geste.current;
    if (!g) {
      // Survol à la souris : le segment élastique suit le pointeur.
      if (courant.current.outil === 'dessin' && e.pointerType === 'mouse' && !courant.current.formulaire) {
        setCurseur(calculerCurseur(pE));
      }
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    if (!g.bouge && distance(pE, g.departEcran) > (g.tactile ? SEUIL_GLISSER_TACTILE : SEUIL_GLISSER_SOURIS)) g.bouge = true;
    if (g.glisser.mode === 'trace') {
      setCurseur(calculerCurseur(pE));
      return;
    }
    if (g.bouge) appliquerGlisser(g, pE);
  }

  function surPointerUp(e: EvenementPointeur<SVGSVGElement>, annule = false) {
    pointeurs.current.delete(e.pointerId);
    const pc = pince.current;
    if (pc) {
      if (pc.ids.includes(e.pointerId)) {
        pince.current = null;
        // Le doigt restant continue de déplacer la vue.
        const reste = [...pointeurs.current.entries()][0];
        if (reste) {
          const v = vueRef.current;
          geste.current = {
            pointerId: reste[0],
            departEcran: reste[1],
            departPlan: versPlan(v, reste[1]),
            tactile: true,
            bouge: true,
            outil: courant.current.outil,
            cible: { type: 'vide' },
            glisser: { mode: 'vue', vueDepart: v },
            cle: '',
          };
        }
      }
      return;
    }
    const g = geste.current;
    if (!g || e.pointerId !== g.pointerId) return;
    geste.current = null;
    if (annule) {
      if (g.glisser.mode === 'trace') setCurseur(null);
      return;
    }
    if (g.glisser.mode === 'trace') {
      poserPointTrace(pointEcran(e), e.pointerType === 'mouse');
      return;
    }
    if (g.bouge) finirGlisser(g);
    else toucher(g);
  }

  // ─── Clavier (PC) ─────────────────────────────────────────────────────

  const clavier = useRef<(e: KeyboardEvent) => void>(() => {});
  clavier.current = (e: KeyboardEvent) => {
    const cible = e.target as HTMLElement | null;
    if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.tagName === 'SELECT' || cible.isContentEditable)) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (formulaire || document.querySelector('.dialogue')) return;
    const etat = useEtat.getState();
    if (e.key === 'Escape') {
      if (outil === 'dessin' && traceRef.current.length > 0) {
        definirTrace([]);
        setCurseur(null);
      } else if (outil !== 'selection') changerOutil('selection');
      else if (etat.selection) etat.selectionner(null);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (outil === 'dessin') {
        if (traceRef.current.length > 0) {
          e.preventDefault();
          retirerDernierPoint();
        }
      } else if (outil === 'selection' && etat.selection) {
        e.preventDefault();
        void supprimerSelection();
      }
    } else if (e.key === 'Enter' && outil === 'dessin' && traceRef.current.length >= 3) {
      e.preventDefault();
      terminerTrace();
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => clavier.current(e);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  // ─── Rendu ───────────────────────────────────────────────────────────

  const idActif = outil === 'selection' ? pieceActive(selection) : null;
  const pieceSelectionnee = idActif ? plan?.pieces.find((p) => p.id === idActif) : undefined;
  const planVide = !!plan && plan.pieces.length === 0;

  return (
    <div className="plan2d" ref={racineRef}>
      <svg
        ref={svgRef}
        className={`plan2d-svg outil-${outil}`}
        role="application"
        aria-roledescription="plan"
        aria-label={`Plan du niveau ${niveau?.nom ?? ''}`}
        data-echelle={vue.echelle}
        data-tx={vue.tx}
        data-ty={vue.ty}
        onPointerDown={surPointerDown}
        onPointerMove={surPointerMove}
        onPointerUp={(e) => surPointerUp(e)}
        onPointerCancel={(e) => surPointerUp(e, true)}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse' && !geste.current) setCurseur(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {taille && <Grille vue={vue} largeur={taille.largeur} hauteur={taille.hauteur} />}
        {plan && catalogue && (
          <g transform={`translate(${vue.tx} ${vue.ty}) scale(${vue.echelle})`}>
            <CalquePlan plan={plan} catalogue={catalogue} selection={outil === 'selection' ? selection : null} echelle={vue.echelle} />
          </g>
        )}
        {plan && <CalqueTextes plan={plan} vue={vue} selection={outil === 'selection' ? selection : null} />}
        {photosNiveau.length > 0 && <CalquePhotos photos={photosNiveau} vue={vue} selection={selection} />}
        {pieceSelectionnee && catalogue && (
          <CalquePoignees piece={pieceSelectionnee} catalogue={catalogue} vue={vue} selection={selection} />
        )}
        {outil === 'dessin' && <CalqueTrace trace={trace} curseur={formulaire ? null : curseur} vue={vue} />}
      </svg>

      <Palette
        outil={outil}
        onOutil={changerOutil}
        onZoomAvant={() => zoomerAuCentre(FACTEUR_ZOOM)}
        onZoomArriere={() => zoomerAuCentre(1 / FACTEUR_ZOOM)}
        onAjuster={ajuster}
      />

      {outil === 'dessin' && !formulaire && (
        <>
          <Bandeau
            aide={
              <>
                <strong>Touchez chaque angle</strong> de la pièce, puis fermez-la sur le premier point. Deux doigts pour
                déplacer la vue.
              </>
            }
          />
          <BarreDessin
            nombrePoints={trace.length}
            onAnnulerPoint={retirerDernierPoint}
            onFermer={terminerTrace}
            onAbandonner={() => changerOutil('selection')}
          />
        </>
      )}
      {outil === 'ouverture' && (
        <Bandeau
          aide={
            <>
              <strong>Touchez un mur</strong> pour y poser :
            </>
          }
          choix={{
            libelle: 'Type d’ouverture',
            valeur: typeOuverture,
            options: TYPES_OUVERTURES.map((t) => ({ valeur: t, libelle: LIBELLES_OUVERTURES[t] })),
            onChange: setTypeOuverture,
          }}
        />
      )}
      {outil === 'equipement' && (
        <Bandeau
          aide={
            <>
              <strong>Touchez une pièce</strong> pour y poser :
            </>
          }
          choix={{
            libelle: 'Type d’équipement',
            valeur: typeEquipement,
            options: TYPES_EQUIPEMENTS.map((t) => ({ valeur: t, libelle: MODELES_EQUIPEMENTS[t].libelle })),
            onChange: setTypeEquipement,
          }}
        />
      )}
      {outil === 'photo' && (
        <Bandeau
          aide={
            <>
              <strong>Touchez l’endroit</strong> où la photo est prise : l’appareil photo s’ouvre.
            </>
          }
        />
      )}

      {planVide && outil === 'selection' && projet && (
        <EtatVidePlan onRelever={() => naviguer({ ecran: 'releve', id: projet.id })} onDessiner={() => changerOutil('dessin')} />
      )}

      <input
        ref={entreePhotoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="visuellement-cache"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void surFichierPhoto(e)}
      />

      {outil === 'selection' && <PanneauProprietes large={large} />}

      <FormulaireNouvellePiece
        ouvert={formulaire}
        points={trace}
        hauteurDefaut={niveau?.hauteurDefaut ?? 250}
        nomParDefaut={`Pièce ${(plan?.pieces.length ?? 0) + 1}`}
        onAnnuler={() => setFormulaire(false)}
        onCreer={creerPiece}
      />
    </div>
  );
}
