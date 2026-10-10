// Colle WebXR (sessionRA.ts) face à une fausse session WebXR : la vraie
// réalité augmentée n'est pas testable ici. Le moteur de rendu de three.js est
// remplacé par un double qui reproduit sa gestion des boucles d'affichage
// (WebGLRenderer.js : setAnimationLoop relance toujours la boucle de la
// fenêtre ; l'événement « sessionstart » l'arrête, « sessionend » la relance).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { SessionRA, type RappelsSessionRA } from './sessionRA';
import { etatInitialRA, reduireRA, type ActionRA, type EtatRA, type Point3 } from './releveRA';

const { FauxRendu } = vi.hoisted(() => {
  type Boucle = (temps: number, image?: unknown) => void;
  class FauxRendu {
    static dernier: FauxRendu | null = null;
    boucle: Boucle | null = null;
    boucleFenetre = false;
    enSession = false;
    imageEnCours: unknown = null;
    dessins = { dansImage: 0, horsImage: 0 };
    espace: EventTarget | null = null;
    xr = {
      enabled: false,
      setReferenceSpaceType: () => undefined,
      setSession: async (session: EventTarget & { requestReferenceSpace(t: string): Promise<EventTarget> }) => {
        this.espace = await session.requestReferenceSpace('local');
        session.addEventListener('end', () => {
          this.enSession = false;
          this.boucleFenetre = true; // « sessionend »
        });
        this.enSession = true;
        this.boucleFenetre = false; // « sessionstart »
      },
      getReferenceSpace: () => this.espace,
    };
    constructor() {
      FauxRendu.dernier = this;
    }
    setPixelRatio() {}
    setSize() {}
    setAnimationLoop(boucle: Boucle | null) {
      this.boucle = boucle;
      this.boucleFenetre = boucle !== null;
    }
    render() {
      if (this.imageEnCours) this.dessins.dansImage++;
      else this.dessins.horsImage++;
    }
    dispose() {}
    forceContextLoss() {}
    /** Une image de la fenêtre (window.requestAnimationFrame). */
    imageFenetre() {
      if (this.boucleFenetre) this.boucle?.(0);
    }
    /** Une image de la session XR. */
    imageSession(image: unknown) {
      if (!this.enSession || !this.boucle) return;
      this.imageEnCours = image;
      try {
        this.boucle(0, image);
      } finally {
        this.imageEnCours = null;
      }
    }
  }
  return { FauxRendu };
});

vi.mock('three', async (importOriginal) => ({ ...(await importOriginal<typeof import('three')>()), WebGLRenderer: FauxRendu }));

const SOL = -1.4; // altitude du sol vue depuis le téléphone (m)
const p = (x: number, z: number, y = SOL): Point3 => ({ x, y, z });
const HAUT: Point3 = { x: 0, y: 1, z: 0 };
/** Téléphone tenu à 1,40 m au-dessus du sol. */
const OEIL = p(0, 0, SOL + 1.4);

class FausseAncre {
  supprimee = false;
  readonly anchorSpace = {};
  constructor(public position: Point3) {}
  delete() {
    this.supprimee = true;
  }
}

class FausseSession extends EventTarget {
  domOverlayState = { type: 'screen' };
  enabledFeatures = ['hit-test', 'dom-overlay', 'anchors'];
  visibilityState = 'visible';
  readonly espaceLocal = new EventTarget();
  readonly ancres: FausseAncre[] = [];
  terminee = false;
  async requestReferenceSpace(type: string) {
    return type === 'viewer' ? new EventTarget() : this.espaceLocal;
  }
  async requestHitTestSource() {
    return { cancel() {} };
  }
  async end() {
    if (this.terminee) throw new DOMException('déjà terminée', 'InvalidStateError');
    this.terminee = true;
    this.dispatchEvent(new Event('end'));
  }
}

interface Resultat {
  position: Point3;
  /** Normale de la surface touchée (axe Y de la pose), vers le haut par défaut. */
  normale?: Point3;
}

function matricePose(position: Point3, normale: Point3): number[] {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(normale.x, normale.y, normale.z).normalize());
  return new Matrix4().compose(new Vector3(position.x, position.y, position.z), q, new Vector3(1, 1, 1)).toArray();
}

/** Fausse image XR : téléphone en `oeil` qui vise `cible`, résultats de visée du plus proche au plus loin. */
function image(session: FausseSession, options: { oeil?: Point3; cible?: Point3; resultats?: Resultat[] } = {}) {
  const { oeil, cible, resultats = [] } = options;
  let vue = null;
  if (oeil && cible) {
    const dir = new Vector3(cible.x - oeil.x, cible.y - oeil.y, cible.z - oeil.z).normalize();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), dir);
    vue = { emulatedPosition: false, transform: { position: { ...oeil, w: 1 }, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } } };
  }
  return {
    getViewerPose: () => vue,
    getHitTestResults: () =>
      resultats.map((r) => ({
        getPose: () => ({ transform: { position: { ...r.position, w: 1 }, matrix: matricePose(r.position, r.normale ?? HAUT) } }),
      })),
    createAnchor: (t: { position: Point3 }) => {
      const a = new FausseAncre({ x: t.position.x, y: t.position.y, z: t.position.z });
      session.ancres.push(a);
      return Promise.resolve(a);
    },
    get trackedAnchors() {
      return new Set(session.ancres.filter((a) => !a.supprimee));
    },
    getPose: (espace: object) => {
      const a = session.ancres.find((x) => x.anchorSpace === espace);
      return a ? { transform: { position: { ...a.position, w: 1 } } } : null;
    },
  };
}

type Rappels = { [K in keyof RappelsSessionRA]: ReturnType<typeof vi.fn> };

async function demarrer() {
  const session = new FausseSession();
  vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
  vi.stubGlobal('window', { devicePixelRatio: 2, innerWidth: 412, innerHeight: 915 });
  vi.stubGlobal(
    'XRRigidTransform',
    class {
      constructor(public position: Point3) {}
    },
  );
  const rappels: Rappels = {
    surVisee: vi.fn(),
    surSelection: vi.fn(),
    surAjustement: vi.fn(),
    surFin: vi.fn(),
    surVisibilite: vi.fn(),
  };
  const racine = new EventTarget() as unknown as HTMLElement;
  const ra = await SessionRA.demarrer(racine, rappels as unknown as RappelsSessionRA);
  return { ra, session, rendu: FauxRendu.dernier!, rappels };
}

function jouer(actions: ActionRA[], depart: EtatRA = etatInitialRA()): EtatRA {
  return actions.reduce(reduireRA, depart);
}

const placer = (x: number, z: number, y = SOL): ActionRA => ({ type: 'placer-angle', point: p(x, z, y) });

function attendreProche(point: Point3 | null, attendu: Point3) {
  expect(point).not.toBeNull();
  expect(point!.x).toBeCloseTo(attendu.x, 3);
  expect(point!.y).toBeCloseTo(attendu.y, 3);
  expect(point!.z).toBeCloseTo(attendu.z, 3);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('boucle d’affichage', () => {
  it('ne dessine que dans les images de la session XR, jamais depuis la boucle de la fenêtre', async () => {
    const { ra, session, rendu } = await demarrer();
    ra.dessiner(etatInitialRA());
    for (let i = 0; i < 3; i++) {
      rendu.imageFenetre();
      rendu.imageSession(image(session));
    }
    expect(rendu.dessins).toEqual({ dansImage: 3, horsImage: 0 });
    // « sessionstart » a bien arrêté la boucle de la fenêtre.
    expect(rendu.boucleFenetre).toBe(false);
    await ra.terminer();
    expect(rendu.boucle).toBeNull();
  });
});

describe('visée d’un angle au sol', () => {
  // Mur détecté (plan vertical) en x = 3 m, normale tournée vers le téléphone.
  const MUR = { x: -1, y: 0, z: 0 };
  const PIED_DU_MUR = p(3, 0, SOL + 0.05);

  it('un mur touché près du sol donne l’angle à son pied, pas derrière lui', async () => {
    const { ra, session, rendu } = await demarrer();
    ra.dessiner(jouer([placer(0, 0)]));
    // Seul le mur est touché : le rayon prolongé jusqu'au sol partirait derrière le mur (3,11 m).
    rendu.imageSession(image(session, { oeil: OEIL, cible: PIED_DU_MUR, resultats: [{ position: PIED_DU_MUR, normale: MUR }] }));
    attendreProche(ra.visee, p(3, 0));
    // Mur puis sol situé derrière lui sur le même rayon.
    rendu.imageSession(
      image(session, {
        oeil: OEIL,
        cible: PIED_DU_MUR,
        resultats: [{ position: PIED_DU_MUR, normale: MUR }, { position: p(3.11, 0) }],
      }),
    );
    attendreProche(ra.visee, p(3, 0));
  });

  it('un mur touché en hauteur masque le sol situé derrière lui', async () => {
    const { ra, session, rendu } = await demarrer();
    ra.dessiner(jouer([placer(0, 0)]));
    const surLeMur = p(3, 0, SOL + 1);
    rendu.imageSession(
      image(session, { oeil: OEIL, cible: surLeMur, resultats: [{ position: surLeMur, normale: MUR }, { position: p(7.5, 0) }] }),
    );
    expect(ra.visee).toBeNull();
  });
});
