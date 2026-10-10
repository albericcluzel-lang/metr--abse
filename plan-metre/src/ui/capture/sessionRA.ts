// Colle WebXR (three.js) du relevé en réalité augmentée : session
// « immersive-ar » d'ARCore dans Chrome, visée par hit-test, réticule,
// marqueurs d'angles, segments et ligne élastique. Toute la logique du relevé
// est dans releveRA.ts (testée) ; ce fichier reste mince et défensif : chaque
// fonctionnalité facultative (surimpression DOM, ancres, visée des points)
// est détectée avant usage.
//
// Repère : espace de référence « local » (mètres, Y vers le haut).

import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  altitudeSol,
  distanceHorizontale,
  estSurfaceSol,
  intersectionRayonSol,
  poseSegment,
  SEUIL_FERMETURE_M,
  type AngleRA,
  type EtatRA,
  type Point3,
  type ZoneTermineeRA,
} from './releveRA';

export type DisponibiliteRA = 'disponible' | 'indisponible' | 'non-securise' | 'sans-webxr';

/** La réalité augmentée (WebXR « immersive-ar ») est-elle utilisable ici ? */
export async function verifierDisponibiliteRA(): Promise<DisponibiliteRA> {
  if (typeof window === 'undefined') return 'sans-webxr';
  if (!window.isSecureContext) return 'non-securise';
  const xr = typeof navigator !== 'undefined' ? navigator.xr : undefined;
  if (!xr || typeof xr.isSessionSupported !== 'function') return 'sans-webxr';
  try {
    return (await xr.isSessionSupported('immersive-ar')) ? 'disponible' : 'indisponible';
  } catch {
    return 'indisponible';
  }
}

export interface Visee {
  /** Point visé (m), null si aucune surface n'est trouvée. */
  point: Point3 | null;
  /** Le téléphone est suivi (sinon : bouger lentement, éclairer). */
  suivi: boolean;
  /** Point calculé sur le plan du sol faute de surface détectée. */
  estime: boolean;
}

export interface RappelsSessionRA {
  /** Visée courante (au plus une dizaine de fois par seconde). */
  surVisee(v: Visee): void;
  /** Toucher de l'écran hors des boutons de la surimpression. */
  surSelection(point: Point3 | null): void;
  /** Le suivi a affiné la position d'angles ancrés. */
  surAjustement(corrections: { id: number; point: Point3 }[]): void;
  /** La session est terminée ; `interrompue` si ce n'est pas à la demande de l'appli. */
  surFin(interrompue: boolean): void;
  /** La session passe au second plan (dialogue système) ou revient. */
  surVisibilite(visible: boolean): void;
}

function erreurNommee(nom: string, message: string): Error {
  const e = new Error(message);
  e.name = nom;
  return e;
}

/** Éléments de la surimpression dont les touchers ne doivent pas poser d'angle. */
const SELECTEUR_INTERACTIF = 'button, input, select, textarea, label, a, [data-ra-panneau]';

const COULEUR_ANGLE = new Color('#ffffff');
const COULEUR_SEGMENT = new Color('#3d7bff');
const COULEUR_ZONE = new Color('#2fbf71');
const COULEUR_FERMETURE = new Color('#2fbf71');
const COULEUR_ESTIME = new Color('#ffb020');

const INTERVALLE_VISEE_MS = 100;
const INTERVALLE_ANCRES_MS = 500;
const SEUIL_AJUSTEMENT_M = 0.01;

export class SessionRA {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(70, 1, 0.01, 50);
  private readonly geometries: BufferGeometry[] = [];
  private readonly materiaux: Material[] = [];
  private readonly reticule: Mesh;
  private readonly matReticule: MeshBasicMaterial;
  private readonly groupeAngles = new Group();
  private readonly groupeSegments = new Group();
  private readonly groupeZones = new Group();
  private readonly elastique: Mesh;
  private readonly fermeture: Mesh;
  private readonly verticale: Mesh;
  private readonly geoMarqueur: BufferGeometry;
  private readonly geoSegment: BufferGeometry;
  private readonly matAngle: MeshBasicMaterial;
  private readonly matPremier: MeshBasicMaterial;
  private readonly matSegment: MeshBasicMaterial;
  private readonly matZone: MeshBasicMaterial;
  private readonly matSolZone: MeshBasicMaterial;
  private geometriesZones: BufferGeometry[] = [];

  private etat: EtatRA | null = null;
  private anglesDessines: readonly AngleRA[] | null = null;
  private fermeDessine = false;
  private zonesDessinees: readonly ZoneTermineeRA[] | null = null;
  private pointVise: Point3 | null = null;
  private derniereVisee = { t: 0, present: false, suivi: false, estime: false };
  private derniersAjustements = 0;
  private readonly ancres = new Map<number, XRAnchor>();
  private readonly ancresDemandees = new Map<number, Point3>();
  private readonly ancresEnCours = new Set<number>();
  private ancresPossibles: boolean;
  private finDemandee = false;
  private nettoye = false;
  /** La surimpression DOM est affichée (sinon : touchers seulement). */
  readonly avecSurimpression: boolean;

  private constructor(
    private readonly session: XRSession,
    private readonly renderer: WebGLRenderer,
    private readonly sourceSol: XRHitTestSource,
    private readonly sourcePlafond: XRHitTestSource | null,
    private readonly racine: HTMLElement,
    private readonly rappels: RappelsSessionRA,
  ) {
    this.avecSurimpression = Boolean(session.domOverlayState);
    const fonctions = session.enabledFeatures;
    this.ancresPossibles = fonctions ? fonctions.includes('anchors') : true;

    const geo = <T extends BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };
    const mat = (couleur: Color, opacite = 1): MeshBasicMaterial => {
      const m = new MeshBasicMaterial({ color: couleur, transparent: opacite < 1, opacity: opacite, side: DoubleSide });
      this.materiaux.push(m);
      return m;
    };

    // Réticule : anneau posé à plat sur la surface visée (normale = axe Y de la pose).
    this.matReticule = mat(COULEUR_ANGLE, 0.95);
    this.reticule = new Mesh(geo(new RingGeometry(0.045, 0.06, 40).rotateX(-Math.PI / 2)), this.matReticule);
    const point = new Mesh(geo(new CircleGeometry(0.008, 16).rotateX(-Math.PI / 2)), this.matReticule);
    this.reticule.add(point);
    this.reticule.matrixAutoUpdate = false;
    this.reticule.visible = false;

    this.geoMarqueur = geo(new CylinderGeometry(0.025, 0.025, 0.012, 24));
    // Pavé de 1 m allongé selon x, mis à la longueur du segment par l'échelle.
    this.geoSegment = geo(new BoxGeometry(1, 0.006, 0.014));
    this.matAngle = mat(COULEUR_ANGLE);
    this.matPremier = mat(COULEUR_FERMETURE);
    this.matSegment = mat(COULEUR_SEGMENT);
    this.matZone = mat(COULEUR_ZONE);
    this.matSolZone = mat(COULEUR_ZONE, 0.22);

    this.elastique = new Mesh(this.geoSegment, mat(COULEUR_SEGMENT, 0.6));
    this.fermeture = new Mesh(this.geoSegment, mat(COULEUR_FERMETURE, 0.45));
    this.verticale = new Mesh(geo(new BoxGeometry(0.012, 1, 0.012)), mat(COULEUR_ESTIME, 0.85));
    for (const o of [this.elastique, this.fermeture, this.verticale]) o.visible = false;

    this.scene.add(this.groupeZones, this.groupeSegments, this.groupeAngles, this.elastique, this.fermeture, this.verticale, this.reticule);

    session.addEventListener('end', this.surFinSession);
    session.addEventListener('select', this.surSelect);
    session.addEventListener('visibilitychange', this.surChangementVisibilite);
    racine.addEventListener('beforexrselect', this.surAvantSelection);
    renderer.setAnimationLoop(this.image);
  }

  /**
   * Démarre la session. À appeler directement depuis un toucher (geste de
   * l'utilisateur exigé par le navigateur). `racine` est l'élément affiché en
   * surimpression (il doit être dans le document).
   */
  static async demarrer(racine: HTMLElement, rappels: RappelsSessionRA): Promise<SessionRA> {
    const xr = navigator.xr;
    if (!xr) throw erreurNommee('NotSupportedError', 'WebXR absent');
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      throw erreurNommee('WebGLIndisponible', 'WebGL indisponible');
    }
    let session: XRSession;
    try {
      session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'local-floor', 'anchors'],
        domOverlay: { root: racine },
      });
    } catch (e) {
      liberer(renderer);
      throw e;
    }
    try {
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local');
      await renderer.xr.setSession(session);
      const espaceVue = await session.requestReferenceSpace('viewer');
      if (typeof session.requestHitTestSource !== 'function') {
        throw erreurNommee('HitTestIndisponible', 'hit-test indisponible');
      }
      const sourceSol = await session.requestHitTestSource({ space: espaceVue });
      if (!sourceSol) throw erreurNommee('HitTestIndisponible', 'hit-test indisponible');
      // Visée de la jonction mur / plafond : plans et points caractéristiques si possible.
      let sourcePlafond: XRHitTestSource | null = null;
      try {
        sourcePlafond = (await session.requestHitTestSource({ space: espaceVue, entityTypes: ['plane', 'point'] })) ?? null;
      } catch {
        sourcePlafond = null;
      }
      return new SessionRA(session, renderer, sourceSol, sourcePlafond, racine, rappels);
    } catch (e) {
      liberer(renderer);
      await session.end().catch(() => undefined);
      throw e;
    }
  }

  /** Dernier point visé (m), null si aucune surface. */
  get visee(): Point3 | null {
    return this.pointVise;
  }

  /** Met à jour le dessin 3D d'après l'état du relevé. */
  dessiner(etat: EtatRA): void {
    if (this.nettoye) return;
    this.etat = etat;
    // Pièce fermée (étape hauteur) : le segment de fermeture est dessiné.
    const ferme = etat.etape === 'hauteur';
    if (etat.angles !== this.anglesDessines || ferme !== this.fermeDessine) {
      this.anglesDessines = etat.angles;
      this.fermeDessine = ferme;
      this.dessinerAngles(etat.angles, ferme);
      this.synchroniserAncres(etat.angles);
    }
    if (etat.zones !== this.zonesDessinees) {
      this.zonesDessinees = etat.zones;
      this.dessinerZones(etat.zones);
    }
  }

  /** Termine la session à la demande de l'appli. */
  async terminer(): Promise<void> {
    if (this.nettoye) return;
    this.finDemandee = true;
    try {
      await this.session.end();
    } catch {
      // Session déjà terminée : l'événement « end » a fait (ou fera) le ménage.
      this.surFinSession();
    }
  }

  // ─── Boucle d'affichage ────────────────────────────────────────────────

  private readonly image = (_temps: number, frame?: XRFrame) => {
    if (this.nettoye) return;
    const espace = this.renderer.xr.getReferenceSpace();
    if (frame && espace) {
      try {
        this.mettreAJourVisee(frame, espace);
        this.mettreAJourAncres(frame, espace);
      } catch (e) {
        // Une image ratée ne doit pas arrêter la session.
        console.warn('Relevé RA : image ignorée', e);
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  private mettreAJourVisee(frame: XRFrame, espace: XRReferenceSpace) {
    const etat = this.etat;
    const vue = frame.getViewerPose(espace);
    const suivi = Boolean(vue) && !vue!.emulatedPosition;
    const modePlafond = etat?.etape === 'hauteur';
    let point: Point3 | null = null;
    let matrice: Float32Array | null = null;
    let estime = false;

    const source = modePlafond ? (this.sourcePlafond ?? this.sourceSol) : this.sourceSol;
    for (const r of frame.getHitTestResults(source)) {
      const pose = r.getPose(espace);
      if (!pose) continue;
      if (!modePlafond && !estSurfaceSol(pose.transform.matrix)) continue;
      const p = pose.transform.position;
      point = { x: p.x, y: p.y, z: p.z };
      matrice = pose.transform.matrix;
      break;
    }
    // Repli : rayon de visée prolongé jusqu'au plan du sol déjà connu.
    const sol = etat ? altitudeSol(etat) : null;
    if (!point && !modePlafond && vue && sol !== null) {
      const o = vue.transform.position;
      const q = vue.transform.orientation;
      const dir = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
      point = intersectionRayonSol({ x: o.x, y: o.y, z: o.z }, { x: dir.x, y: dir.y, z: dir.z }, sol);
      estime = point !== null;
    }
    this.pointVise = point;

    // Réticule.
    if (point) {
      if (matrice) this.reticule.matrix.fromArray(matrice);
      else this.reticule.matrix.makeTranslation(point.x, point.y, point.z);
      this.reticule.visible = true;
      const proche =
        etat?.etape === 'angles' &&
        etat.angles.length >= 3 &&
        distanceHorizontale(point, etat.angles[0]) < SEUIL_FERMETURE_M;
      this.matReticule.color.copy(proche ? COULEUR_FERMETURE : estime ? COULEUR_ESTIME : COULEUR_ANGLE);
    } else {
      this.reticule.visible = false;
    }

    // Ligne élastique depuis le dernier angle, et aperçu de la fermeture.
    const angles = etat?.etape === 'angles' ? etat.angles : [];
    const dernier = angles[angles.length - 1];
    this.poserSegment(this.elastique, dernier && point ? dernier : null, point);
    this.poserSegment(this.fermeture, angles.length >= 2 && point ? point : null, angles[0] ?? null);

    // Étape hauteur : trait vertical du sol jusqu'au point visé.
    if (modePlafond && point && sol !== null && point.y > sol) {
      const h = point.y - sol;
      this.verticale.position.set(point.x, sol + h / 2, point.z);
      this.verticale.scale.set(1, h, 1);
      this.verticale.visible = true;
    } else {
      this.verticale.visible = false;
    }

    // Transmission à l'interface, sans la submerger.
    const maintenant = performance.now();
    const d = this.derniereVisee;
    if (
      maintenant - d.t >= INTERVALLE_VISEE_MS ||
      d.present !== (point !== null) ||
      d.suivi !== suivi ||
      d.estime !== estime
    ) {
      this.derniereVisee = { t: maintenant, present: point !== null, suivi, estime };
      this.rappels.surVisee({ point, suivi, estime });
    }
  }

  private poserSegment(mesh: Mesh, a: Point3 | null, b: Point3 | null) {
    if (!a || !b) {
      mesh.visible = false;
      return;
    }
    const s = poseSegment(a, b);
    if (s.longueur < 0.005) {
      mesh.visible = false;
      return;
    }
    mesh.position.set(s.milieu.x, s.milieu.y + 0.003, s.milieu.z);
    mesh.rotation.set(0, s.rotationY, 0);
    mesh.scale.set(s.longueur, 1, 1);
    mesh.visible = true;
  }

  // ─── Dessin des angles et des zones ────────────────────────────────────

  private dessinerAngles(angles: readonly AngleRA[], ferme: boolean) {
    this.groupeAngles.clear();
    this.groupeSegments.clear();
    angles.forEach((a, i) => {
      const m = new Mesh(this.geoMarqueur, i === 0 ? this.matPremier : this.matAngle);
      m.position.set(a.x, a.y + 0.006, a.z);
      this.groupeAngles.add(m);
      const suivant = i + 1 < angles.length ? angles[i + 1] : ferme && angles.length >= 3 ? angles[0] : null;
      if (suivant) {
        const s = new Mesh(this.geoSegment, this.matSegment);
        this.poserSegment(s, a, suivant);
        this.groupeSegments.add(s);
      }
    });
  }

  private dessinerZones(zones: readonly ZoneTermineeRA[]) {
    this.groupeZones.clear();
    for (const g of this.geometriesZones) g.dispose();
    this.geometriesZones = [];
    for (const z of zones) {
      z.angles.forEach((a, i) => {
        const s = new Mesh(this.geoSegment, this.matZone);
        this.poserSegment(s, { ...a, y: z.sol }, { ...z.angles[(i + 1) % z.angles.length], y: z.sol });
        this.groupeZones.add(s);
      });
      // Surface au sol translucide (forme dans le plan x / −z, couchée ensuite).
      const forme = new Shape(z.angles.map((a) => new Vector2(a.x, -a.z)));
      const g = new ShapeGeometry(forme).rotateX(-Math.PI / 2);
      this.geometriesZones.push(g);
      const sol = new Mesh(g, this.matSolZone);
      sol.position.y = z.sol + 0.002;
      this.groupeZones.add(sol);
    }
  }

  // ─── Ancres (facultatives) : le suivi corrige la position des angles ──

  private synchroniserAncres(angles: readonly AngleRA[]) {
    if (!this.ancresPossibles) return;
    const ids = new Set(angles.map((a) => a.id));
    for (const [id, ancre] of this.ancres) {
      if (!ids.has(id)) {
        supprimerAncre(ancre);
        this.ancres.delete(id);
      }
    }
    for (const id of this.ancresDemandees.keys()) if (!ids.has(id)) this.ancresDemandees.delete(id);
    for (const a of angles) {
      if (!this.ancres.has(a.id) && !this.ancresEnCours.has(a.id)) this.ancresDemandees.set(a.id, { x: a.x, y: a.y, z: a.z });
    }
  }

  private mettreAJourAncres(frame: XRFrame, espace: XRReferenceSpace) {
    if (!this.ancresPossibles) return;
    if (this.ancresDemandees.size > 0 && typeof frame.createAnchor === 'function' && typeof XRRigidTransform !== 'undefined') {
      for (const [id, p] of this.ancresDemandees) {
        let promesse: Promise<XRAnchor> | undefined;
        try {
          promesse = frame.createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }), espace);
        } catch {
          // Ancres refusées par le navigateur : on s'en passe pour la suite.
          this.ancresPossibles = false;
          break;
        }
        if (!promesse) continue;
        this.ancresEnCours.add(id);
        promesse
          .then((ancre) => {
            this.ancresEnCours.delete(id);
            const encore = this.anglesDessines?.some((a) => a.id === id);
            if (this.nettoye || !encore) supprimerAncre(ancre);
            else this.ancres.set(id, ancre);
          })
          .catch(() => this.ancresEnCours.delete(id));
      }
      this.ancresDemandees.clear();
    }
    const maintenant = performance.now();
    if (this.ancres.size === 0 || maintenant - this.derniersAjustements < INTERVALLE_ANCRES_MS) return;
    this.derniersAjustements = maintenant;
    const suivies = frame.trackedAnchors;
    const corrections: { id: number; point: Point3 }[] = [];
    for (const a of this.anglesDessines ?? []) {
      const ancre = this.ancres.get(a.id);
      if (!ancre || (suivies && !suivies.has(ancre))) continue;
      const pose = frame.getPose(ancre.anchorSpace, espace);
      if (!pose) continue;
      const p = pose.transform.position;
      if (Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) > SEUIL_AJUSTEMENT_M) {
        corrections.push({ id: a.id, point: { x: p.x, y: p.y, z: p.z } });
      }
    }
    if (corrections.length > 0) this.rappels.surAjustement(corrections);
  }

  // ─── Événements ────────────────────────────────────────────────────────

  private readonly surSelect = () => {
    this.rappels.surSelection(this.pointVise);
  };

  private readonly surAvantSelection = (e: Event) => {
    const cible = e.target;
    if (cible instanceof Element && cible !== this.racine && cible.closest(SELECTEUR_INTERACTIF)) e.preventDefault();
  };

  private readonly surChangementVisibilite = () => {
    this.rappels.surVisibilite(this.session.visibilityState === 'visible');
  };

  private readonly surFinSession = () => {
    if (this.nettoye) return;
    this.nettoyer();
    this.rappels.surFin(!this.finDemandee);
  };

  /** Libère tout : boucle, sources de visée, ancres, écouteurs, ressources GPU. */
  private nettoyer() {
    this.nettoye = true;
    this.renderer.setAnimationLoop(null);
    for (const s of [this.sourceSol, this.sourcePlafond]) {
      try {
        s?.cancel();
      } catch {
        // Déjà annulée avec la session.
      }
    }
    for (const a of this.ancres.values()) supprimerAncre(a);
    this.ancres.clear();
    this.ancresDemandees.clear();
    this.session.removeEventListener('end', this.surFinSession);
    this.session.removeEventListener('select', this.surSelect);
    this.session.removeEventListener('visibilitychange', this.surChangementVisibilite);
    this.racine.removeEventListener('beforexrselect', this.surAvantSelection);
    this.scene.clear();
    for (const g of [...this.geometries, ...this.geometriesZones]) g.dispose();
    for (const m of this.materiaux) m.dispose();
    this.geometriesZones = [];
    liberer(this.renderer);
  }
}

function supprimerAncre(a: XRAnchor) {
  try {
    a.delete();
  } catch {
    // Ancre déjà supprimée avec la session.
  }
}

function liberer(renderer: WebGLRenderer) {
  try {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.forceContextLoss();
  } catch {
    // Contexte déjà perdu.
  }
}
