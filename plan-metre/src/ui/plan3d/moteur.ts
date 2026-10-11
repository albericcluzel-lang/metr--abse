// Moteur de la vue 3D : rendu WebGL, caméra orbitale, étiquettes des pièces.
//
//  - Rendu à la demande : une image n'est dessinée que lorsque quelque chose
//    bouge (geste, inertie, recentrage, redimensionnement, nouveau plan).
//  - Gestes (OrbitControls) : un doigt / clic gauche = tourner ; deux doigts =
//    zoomer et déplacer ; molette = zoomer vers le pointeur ; clic droit ou
//    Maj + clic = déplacer ; flèches = déplacer, + / − = zoomer (clavier).
//  - Densité de pixels plafonnée à 2 (téléphones à écran très dense).
//  - Tout est libéré au démontage (géométries, matériaux, contexte WebGL).

import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Group,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Catalogue, Plan } from '../../model/types';
import { calculerCadrage, DIRECTION_VUE, DIRECTION_VUE_PORTRAIT } from './repere';
import { construireGroupePlan, COULEURS_3D, etiquettesPieces, libererGroupe } from './scene';

export interface RappelsMoteur {
  /** Premier geste de l'utilisateur sur la vue (pour masquer l'aide). */
  surInteraction?: () => void;
  /** Contexte WebGL perdu (false) puis rétabli (true) par le navigateur. */
  surContexte?: (disponible: boolean) => void;
}

const CHAMP_VERTICAL = 45;
const DUREE_RECENTRAGE = 350;
const DENSITE_MAXI = 2;

interface Etiquette {
  element: HTMLElement;
  position: Vector3;
  /** Taille mesurée une fois pour toutes (px). */
  largeur: number;
  hauteur: number;
}

/** Écart minimal entre deux étiquettes (px). */
const ECART_ETIQUETTES = 4;

interface Animation {
  debut: number | null;
  dePosition: Vector3;
  deCible: Vector3;
  versPosition: Vector3;
  versCible: Vector3;
}

export class MoteurVue3D {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CHAMP_VERTICAL, 1, 0.05, 200);
  private readonly controles: OrbitControls;
  private readonly observateur: ResizeObserver;
  private groupe: Group | null = null;
  /**
   * Maquettes remplacées, libérées juste après l'image suivante : les nouveaux
   * matériaux reprennent alors les programmes de shaders déjà compilés au lieu
   * de les recompiler à chaque modification du plan.
   */
  private anciensGroupes: Group[] = [];
  private boite = new Box3();
  private signatureBoite = '';
  private etiquettes: Etiquette[] = [];
  private largeur = 0;
  private hauteur = 0;
  private idImage: number | null = null;
  private animation: Animation | null = null;
  /** L'utilisateur a bougé la caméra depuis le dernier cadrage automatique. */
  private interagi = false;
  private rendus = 0;
  private libere = false;
  private readonly projete = new Vector3();

  /** Crée le moteur dans `conteneur`, ou renvoie null si WebGL 2 est indisponible. */
  static creer(conteneur: HTMLElement, calqueEtiquettes: HTMLElement, rappels: RappelsMoteur = {}): MoteurVue3D | null {
    const canevas = document.createElement('canvas');
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canevas.getContext('webgl2', {
        antialias: true,
        alpha: false,
        depth: true,
        stencil: false,
        powerPreference: 'default',
        preserveDrawingBuffer: false,
      });
    } catch {
      gl = null;
    }
    if (!gl) return null;
    try {
      return new MoteurVue3D(conteneur, calqueEtiquettes, canevas, gl, rappels);
    } catch (e) {
      console.warn('Vue 3D : initialisation impossible', e);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canevas.remove();
      return null;
    }
  }

  private constructor(
    private readonly conteneur: HTMLElement,
    private readonly calque: HTMLElement,
    private readonly canevas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    private readonly rappels: RappelsMoteur,
  ) {
    this.renderer = new WebGLRenderer({ canvas: canevas, context: gl, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DENSITE_MAXI));
    this.renderer.setClearColor(COULEURS_3D.fond, 1);
    canevas.className = 'vue3d-canevas';
    conteneur.appendChild(canevas);

    // Lumière douce du ciel + lumière principale qui suit la caméra (venant
    // d'en haut à gauche) : les faces restent lisibles sous tous les angles.
    this.scene.add(new HemisphereLight('#ffffff', '#dfe2ec', 2.5));
    const principale = new DirectionalLight('#ffffff', 1.4);
    principale.position.set(-3, 2.5, 2);
    principale.target.position.set(0, 0, -6);
    this.camera.add(principale, principale.target);
    this.scene.add(this.camera);

    const c = new OrbitControls(this.camera, canevas);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.maxPolarAngle = Math.PI / 2 - 0.03; // on reste au-dessus du sol
    c.minDistance = 0.4;
    c.listenToKeyEvents(conteneur);
    c.addEventListener('change', this.demanderRendu);
    c.addEventListener('start', this.surGeste);
    this.controles = c;

    conteneur.addEventListener('keydown', this.surTouche);
    canevas.addEventListener('webglcontextlost', this.surPerteContexte);
    canevas.addEventListener('webglcontextrestored', this.surRetourContexte);

    this.observateur = new ResizeObserver(() => this.redimensionner());
    this.observateur.observe(conteneur);
    this.redimensionner();
  }

  /** Remplace la maquette affichée. Le cadrage est refait si le plan a changé d'emprise. */
  afficherPlan(plan: Plan, catalogue: Catalogue): void {
    if (this.libere) return;
    if (this.groupe) {
      this.groupe.removeFromParent();
      this.anciensGroupes.push(this.groupe);
      // Sans image entre deux changements (vue masquée), inutile d'en garder plus d'une.
      while (this.anciensGroupes.length > 1) libererGroupe(this.anciensGroupes.shift()!);
    }
    this.groupe = construireGroupePlan(plan, catalogue);
    this.scene.add(this.groupe);
    this.boite = new Box3().setFromObject(this.groupe);
    this.creerEtiquettes(plan);
    const signature = this.boite.isEmpty()
      ? 'vide'
      : [...this.boite.min.toArray(), ...this.boite.max.toArray()].map((v) => Math.round(v * 2)).join(',');
    if (!this.interagi || signature !== this.signatureBoite) this.recadrer(false);
    this.signatureBoite = signature;
    this.demanderRendu();
  }

  /** Revient à la vue d'ensemble (3/4 plongeante). */
  recentrer(anime = true): void {
    this.recadrer(anime && !mouvementReduit());
  }

  liberer(): void {
    if (this.libere) return;
    this.libere = true;
    if (this.idImage !== null) cancelAnimationFrame(this.idImage);
    this.idImage = null;
    this.observateur.disconnect();
    this.conteneur.removeEventListener('keydown', this.surTouche);
    this.canevas.removeEventListener('webglcontextlost', this.surPerteContexte);
    this.canevas.removeEventListener('webglcontextrestored', this.surRetourContexte);
    this.controles.removeEventListener('change', this.demanderRendu);
    this.controles.removeEventListener('start', this.surGeste);
    this.controles.dispose();
    if (this.groupe) libererGroupe(this.groupe);
    this.groupe = null;
    this.libererAnciensGroupes();
    this.calque.replaceChildren();
    this.etiquettes = [];
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canevas.remove();
  }

  // ─── Cadrage ──────────────────────────────────────────────────────────────

  private recadrer(anime: boolean): void {
    // Écran en hauteur (téléphone) : vue plus plongeante, le plan remplit mieux l'écran.
    const direction = this.camera.aspect < 1 ? DIRECTION_VUE_PORTRAIT : DIRECTION_VUE;
    const c = calculerCadrage(this.boite, this.camera.aspect, CHAMP_VERTICAL, { direction, marge: 1.1 });
    this.interagi = false;
    this.camera.near = Math.max(0.02, c.distance / 200);
    this.camera.far = c.distance * 30 + 50;
    this.camera.updateProjectionMatrix();
    this.controles.maxDistance = Math.max(c.distance * 4, 12);
    // Vide l'inertie d'un geste en cours avant de déplacer la caméra.
    this.controles.enableDamping = false;
    this.controles.update();
    this.controles.enableDamping = true;
    if (anime) {
      this.animation = {
        debut: null,
        dePosition: this.camera.position.clone(),
        deCible: this.controles.target.clone(),
        versPosition: c.position,
        versCible: c.cible,
      };
    } else {
      this.animation = null;
      this.camera.position.copy(c.position);
      this.controles.target.copy(c.cible);
      this.controles.update();
    }
    this.demanderRendu();
  }

  private avancerAnimation(temps: number): void {
    const a = this.animation;
    if (!a) return;
    if (a.debut === null) a.debut = temps;
    const f = Math.min(1, (temps - a.debut) / DUREE_RECENTRAGE);
    const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
    this.camera.position.lerpVectors(a.dePosition, a.versPosition, e);
    this.controles.target.lerpVectors(a.deCible, a.versCible, e);
    if (f >= 1) this.animation = null;
    else this.demanderRendu();
  }

  // ─── Rendu ────────────────────────────────────────────────────────────────

  private readonly demanderRendu = (): void => {
    if (this.idImage !== null || this.libere) return;
    this.idImage = requestAnimationFrame(this.rendreImage);
  };

  private readonly rendreImage = (temps: number): void => {
    this.idImage = null;
    if (this.libere) return;
    this.avancerAnimation(temps);
    // Avec l'inertie, update() signale un changement tant que la caméra glisse
    // encore, ce qui redemande une image ; sinon le rendu s'arrête.
    this.controles.update();
    this.rendre();
  };

  private rendre(): void {
    if (this.largeur === 0 || this.hauteur === 0) return;
    this.renderer.render(this.scene, this.camera);
    this.libererAnciensGroupes();
    this.rendus++;
    // Compteurs lus par les tests de bout en bout (rendu à la demande, fuites mémoire).
    this.conteneur.dataset.rendus = String(this.rendus);
    this.conteneur.dataset.geometries = String(this.renderer.info.memory.geometries);
    this.placerEtiquettes();
  }

  private libererAnciensGroupes(): void {
    for (const g of this.anciensGroupes) libererGroupe(g);
    this.anciensGroupes = [];
  }

  private redimensionner(): void {
    if (this.libere) return;
    const l = this.conteneur.clientWidth;
    const h = this.conteneur.clientHeight;
    // La densité change avec le zoom du navigateur (PC) ou un écran externe.
    const densite = Math.min(window.devicePixelRatio || 1, DENSITE_MAXI);
    const memeDensite = densite === this.renderer.getPixelRatio();
    if (l === 0 || h === 0 || (l === this.largeur && h === this.hauteur && memeDensite)) return;
    this.largeur = l;
    this.hauteur = h;
    if (!memeDensite) this.renderer.setPixelRatio(densite);
    this.renderer.setSize(l, h, false);
    this.camera.aspect = l / h;
    this.camera.updateProjectionMatrix();
    if (!this.interagi && !this.animation) this.recadrer(false);
    // Rendu immédiat : le redimensionnement efface le canevas, on évite une image vide.
    this.rendre();
  }

  // ─── Étiquettes ───────────────────────────────────────────────────────────

  private creerEtiquettes(plan: Plan): void {
    this.calque.replaceChildren();
    // Les plus grandes pièces d'abord : en cas de chevauchement, ce sont elles qui gardent leur étiquette.
    const liste = etiquettesPieces(plan).sort((a, b) => b.aire - a.aire);
    this.etiquettes = liste.map((e) => {
      const element = document.createElement('div');
      element.className = 'vue3d-etiquette';
      element.style.visibility = 'hidden'; // jusqu'à son placement à la prochaine image
      const nom = document.createElement('span');
      nom.className = 'vue3d-etiquette-nom';
      nom.textContent = e.nom;
      const surface = document.createElement('span');
      surface.className = 'vue3d-etiquette-surface';
      surface.textContent = e.surface;
      element.append(nom, surface);
      this.calque.append(element);
      return { element, position: new Vector3(e.position.x, e.position.y, e.position.z), largeur: 0, hauteur: 0 };
    });
  }

  /** Place les étiquettes sur leur pièce ; une étiquette qui en chevaucherait une autre est masquée. */
  private placerEtiquettes(): void {
    const places: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    for (const e of this.etiquettes) {
      if (e.largeur === 0) {
        e.largeur = e.element.offsetWidth;
        e.hauteur = e.element.offsetHeight;
      }
      const p = this.projete.copy(e.position).project(this.camera);
      const x = ((p.x + 1) / 2) * this.largeur;
      const y = ((1 - p.y) / 2) * this.hauteur;
      const r = {
        x0: x - e.largeur / 2 - ECART_ETIQUETTES,
        y0: y - e.hauteur / 2 - ECART_ETIQUETTES,
        x1: x + e.largeur / 2 + ECART_ETIQUETTES,
        y1: y + e.hauteur / 2 + ECART_ETIQUETTES,
      };
      const visible =
        p.z > -1 &&
        p.z < 1 &&
        Math.abs(p.x) <= 1.05 &&
        Math.abs(p.y) <= 1.05 &&
        !places.some((q) => r.x0 < q.x1 && q.x0 < r.x1 && r.y0 < q.y1 && q.y0 < r.y1);
      e.element.style.visibility = visible ? '' : 'hidden';
      if (!visible) continue;
      places.push(r);
      e.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }

  // ─── Événements ───────────────────────────────────────────────────────────

  private marquerInteraction(): void {
    this.animation = null;
    if (!this.interagi) {
      this.interagi = true;
      this.rappels.surInteraction?.();
    }
  }

  private readonly surGeste = (): void => this.marquerInteraction();

  private readonly surTouche = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let facteur = 0;
    if (e.key === '+' || e.key === '=') facteur = 0.8;
    else if (e.key === '-' || e.key === '_') facteur = 1.25;
    else {
      if (e.key.startsWith('Arrow')) this.marquerInteraction();
      return;
    }
    e.preventDefault();
    this.marquerInteraction();
    const c = this.controles;
    const decalage = this.camera.position.clone().sub(c.target);
    const d = Math.min(c.maxDistance, Math.max(c.minDistance, decalage.length() * facteur));
    this.camera.position.copy(c.target).addScaledVector(decalage.normalize(), d);
    c.update();
  };

  private readonly surPerteContexte = (): void => {
    this.rappels.surContexte?.(false);
  };

  private readonly surRetourContexte = (): void => {
    this.rappels.surContexte?.(true);
    this.demanderRendu();
  };
}

function mouvementReduit(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
