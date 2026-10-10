import { describe, expect, it } from 'vitest';
import {
  aireAnglesM2,
  altitudeSol,
  anglesEnPlan,
  cloturerSession,
  distanceHorizontale,
  estSurfaceSol,
  etatInitialRA,
  infosVisee,
  intersectionRayonSol,
  messageErreurRA,
  poseSegment,
  problemeFermeture,
  reduireRA,
  type ActionRA,
  type EtatRA,
  type Point3,
} from './releveRA';

const SOL = -1.4; // altitude du sol vue depuis le téléphone (m)
const p = (x: number, z: number, y = SOL): Point3 => ({ x, y, z });

function jouer(actions: ActionRA[], depart: EtatRA = etatInitialRA()): EtatRA {
  return actions.reduce(reduireRA, depart);
}

const placer = (x: number, z: number, y = SOL): ActionRA => ({ type: 'placer-angle', point: p(x, z, y) });

/** Pièce de 4 m × 3 m dont les angles sont posés dans le sens horaire vu de dessus. */
const rectangle: ActionRA[] = [placer(0, 0), placer(4, 0), placer(4, 3), placer(0, 3)];

describe('pose des angles', () => {
  it('ajoute les angles avec un identifiant croissant', () => {
    const e = jouer(rectangle);
    expect(e.etape).toBe('angles');
    expect(e.angles.map((a) => a.id)).toEqual([1, 2, 3, 4]);
    expect(e.angles[1]).toMatchObject({ x: 4, y: SOL, z: 0 });
    expect(e.message).toBeNull();
  });

  it('ignore un double toucher (moins de 5 cm du précédent)', () => {
    const e = jouer([placer(0, 0), placer(0.03, 0.01)]);
    expect(e.angles).toHaveLength(1);
    expect(e.message).toMatch(/trop proche/);
    // Le message s'efface à l'action suivante réussie.
    expect(reduireRA(e, placer(1, 0)).message).toBeNull();
  });

  it('ignore une visée invalide', () => {
    const e = jouer([{ type: 'placer-angle', point: { x: NaN, y: 0, z: 0 } }]);
    expect(e.angles).toHaveLength(0);
  });

  it('annule le dernier angle', () => {
    const e = jouer([...rectangle, { type: 'annuler-angle' }]);
    expect(e.angles).toHaveLength(3);
    expect(jouer([{ type: 'annuler-angle' }]).angles).toHaveLength(0);
    // Après annulation, les identifiants ne sont pas réutilisés (ancres).
    expect(reduireRA(e, placer(0, 3)).angles[3].id).toBe(5);
  });
});

describe('fermeture de la pièce', () => {
  it('refuse de fermer avec moins de 3 angles', () => {
    const e = jouer([placer(0, 0), placer(4, 0), { type: 'fermer' }]);
    expect(e.etape).toBe('angles');
    expect(e.message).toMatch(/au moins 3 angles/);
  });

  it('ferme avec le bouton', () => {
    const e = jouer([...rectangle, { type: 'fermer' }]);
    expect(e.etape).toBe('hauteur');
    expect(e.angles).toHaveLength(4);
  });

  it('viser le premier angle (à moins de 15 cm) referme la pièce', () => {
    const e = jouer([...rectangle, placer(0.1, 0.05)]);
    expect(e.etape).toBe('hauteur');
    expect(e.angles).toHaveLength(4);
  });

  it('pas de fermeture automatique avant le 3e angle', () => {
    const e = jouer([placer(0, 0), placer(4, 0), placer(0.1, 0)]);
    expect(e.etape).toBe('angles');
    expect(e.angles).toHaveLength(3);
  });

  it('refuse des côtés qui se croisent ou une pièce minuscule', () => {
    const croise = jouer([placer(0, 0), placer(4, 3), placer(4, 0), placer(0, 3), { type: 'fermer' }]);
    expect(croise.etape).toBe('angles');
    expect(croise.message).toMatch(/croisent/);
    const minuscule = jouer([placer(0, 0), placer(0.3, 0), placer(0.3, 0.3), { type: 'fermer' }]);
    expect(minuscule.etape).toBe('angles');
    expect(minuscule.message).toMatch(/trop petite/);
    expect(problemeFermeture(jouer(rectangle).angles)).toBeNull();
  });

  it('on peut revenir aux angles depuis l’étape hauteur', () => {
    const e = jouer([...rectangle, { type: 'fermer' }, { type: 'modifier-angles' }, { type: 'annuler-angle' }]);
    expect(e.etape).toBe('angles');
    expect(e.angles).toHaveLength(3);
  });

  it('ne pose plus d’angle pendant l’étape hauteur', () => {
    const e = jouer([...rectangle, { type: 'fermer' }, placer(2, 2)]);
    expect(e.angles).toHaveLength(4);
  });
});

describe('hauteur sous plafond', () => {
  const ferme = jouer([...rectangle, { type: 'fermer' }]);

  it('mesure la hauteur : y du point visé − y du sol', () => {
    const e = reduireRA(ferme, { type: 'mesurer-hauteur', point: p(2, 0, SOL + 2.52) });
    expect(e.hauteur).toBe(252);
    expect(e.hauteurMesuree).toBe(true);
  });

  it('le sol est la moyenne des angles posés', () => {
    const e = jouer([placer(0, 0, -1.41), placer(4, 0, -1.39), placer(4, 3, -1.4), { type: 'fermer' }]);
    expect(altitudeSol(e)).toBeCloseTo(-1.4);
    expect(reduireRA(e, { type: 'mesurer-hauteur', point: p(1, 1, 1.1) }).hauteur).toBe(250);
  });

  it('refuse une hauteur mesurée improbable', () => {
    const e = reduireRA(ferme, { type: 'mesurer-hauteur', point: p(2, 0, SOL + 0.4) });
    expect(e.hauteur).toBeNull();
    expect(e.message).toMatch(/improbable \(40 cm\)/);
  });

  it('accepte une hauteur saisie raisonnable', () => {
    expect(reduireRA(ferme, { type: 'saisir-hauteur', hauteur: 249.6 })).toMatchObject({
      hauteur: 250,
      hauteurMesuree: false,
    });
    expect(reduireRA(ferme, { type: 'saisir-hauteur', hauteur: 20 }).hauteur).toBeNull();
    expect(reduireRA(ferme, { type: 'saisir-hauteur', hauteur: NaN }).hauteur).toBeNull();
  });

  it('ignore la hauteur hors de l’étape hauteur', () => {
    const e = jouer([...rectangle, { type: 'saisir-hauteur', hauteur: 250 }]);
    expect(e.hauteur).toBeNull();
  });
});

describe('zones successives dans la même session', () => {
  it('termine la zone puis en relève une autre dans le même repère', () => {
    let e = jouer([...rectangle, { type: 'fermer' }, { type: 'terminer-zone' }]);
    expect(e.etape).toBe('hauteur');
    expect(e.message).toMatch(/hauteur/);
    e = jouer([{ type: 'saisir-hauteur', hauteur: 250 }, { type: 'terminer-zone' }], e);
    expect(e.etape).toBe('zone-terminee');
    expect(e.angles).toEqual([]);
    expect(e.zones).toHaveLength(1);
    expect(e.zones[0]).toMatchObject({ hauteur: 250, hauteurMesuree: false });
    expect(e.zones[0].sol).toBeCloseTo(SOL);
    // Les angles des zones terminées ne portent plus d'identifiant d'ancre.
    expect(e.zones[0].angles[0]).toEqual({ x: 0, y: SOL, z: 0 });

    // Pas d'angle tant qu'on n'a pas demandé une nouvelle zone.
    expect(reduireRA(e, placer(5, 0)).angles).toHaveLength(0);
    e = jouer([{ type: 'nouvelle-zone' }, placer(4.2, 0), placer(7, 0), placer(7, 3)], e);
    expect(e.etape).toBe('angles');
    expect(e.angles).toHaveLength(3);
    expect(e.zones).toHaveLength(1);
  });

  it('le sol de la zone précédente sert de référence avant le premier angle', () => {
    const e = jouer([
      ...rectangle,
      { type: 'fermer' },
      { type: 'saisir-hauteur', hauteur: 250 },
      { type: 'terminer-zone' },
      { type: 'nouvelle-zone' },
    ]);
    expect(altitudeSol(e)).toBeCloseTo(SOL);
    expect(altitudeSol(etatInitialRA())).toBeNull();
  });
});

describe('ajustement des angles par les ancres', () => {
  it('remplace la position des angles corrigés, garde leur identifiant', () => {
    const e = jouer(rectangle);
    const r = reduireRA(e, { type: 'ajuster-angles', corrections: [{ id: 2, point: p(4.02, 0.01) }] });
    expect(r.angles[1]).toEqual({ id: 2, x: 4.02, y: SOL, z: 0.01 });
    expect(r.angles[0]).toBe(e.angles[0]);
  });
  it('ignore les identifiants inconnus sans changer l’état', () => {
    const e = jouer(rectangle);
    expect(reduireRA(e, { type: 'ajuster-angles', corrections: [{ id: 99, point: p(1, 1) }] })).toBe(e);
  });
});

describe('messages', () => {
  it('affiche puis efface un avertissement', () => {
    const e = reduireRA(etatInitialRA(), { type: 'signaler', message: 'Aucune surface visée' });
    expect(e.message).toBe('Aucune surface visée');
    expect(reduireRA(e, { type: 'effacer-message' }).message).toBeNull();
    const vide = etatInitialRA();
    expect(reduireRA(vide, { type: 'effacer-message' })).toBe(vide);
  });
  it('repart de zéro pour une nouvelle session', () => {
    expect(jouer([...rectangle, { type: 'reinitialiser' }])).toEqual(etatInitialRA());
  });
});

describe('informations de visée', () => {
  it('distance en direct depuis le dernier angle et proximité du premier', () => {
    const e = jouer([placer(0, 0), placer(4, 0), placer(4, 3)]);
    const loin = infosVisee(e, p(1, 3));
    expect(loin.distanceDernier).toBe(300);
    expect(loin.procheDuPremier).toBe(false);
    expect(loin.peutFermer).toBe(true);
    const pres = infosVisee(e, p(0.1, 0.1));
    expect(pres.procheDuPremier).toBe(true);
    expect(infosVisee(e, null)).toMatchObject({ distanceDernier: null, procheDuPremier: false, peutFermer: true });
    expect(infosVisee(etatInitialRA(), p(1, 1)).distanceDernier).toBeNull();
  });

  it('hauteur visée à l’étape hauteur', () => {
    const e = jouer([...rectangle, { type: 'fermer' }]);
    expect(infosVisee(e, p(1, 1, SOL + 2.4)).hauteur).toBe(240);
    expect(infosVisee(e, p(1, 1, SOL + 2.4)).distanceDernier).toBeNull();
  });

  it('distance horizontale : l’altitude ne compte pas', () => {
    expect(distanceHorizontale(p(0, 0, 0), p(3, 4, 10))).toBe(5);
  });
});

describe('conversion vers le plan', () => {
  it('(x, z) du monde en m → (x·100, z·100) du plan en cm', () => {
    expect(anglesEnPlan([p(1.5, -2), p(0, 0.25)])).toEqual([
      { x: 150, y: -200 },
      { x: 0, y: 25 },
    ]);
    expect(aireAnglesM2(jouer(rectangle).angles)).toBeCloseTo(12);
  });
});

describe('fin de session', () => {
  it('garde les zones terminées et la zone en cours si elle forme une pièce', () => {
    const e = jouer([
      ...rectangle,
      { type: 'fermer' },
      { type: 'mesurer-hauteur', point: p(0, 0, SOL + 2.6) },
      { type: 'terminer-zone' },
      { type: 'nouvelle-zone' },
      placer(5, 0),
      placer(8, 0),
      placer(8, 2),
    ]);
    const bilan = cloturerSession(e, 250);
    expect(bilan.zoneEnCoursConservee).toBe(true);
    expect(bilan.anglesPerdus).toBe(0);
    expect(bilan.zones).toHaveLength(2);
    expect(bilan.zones[0]).toMatchObject({ hauteur: 260, hauteurMesuree: true });
    expect(bilan.zones[1]).toMatchObject({ hauteur: 250, hauteurMesuree: false });
    expect(bilan.zones[1].angles).toHaveLength(3);
  });

  it('garde la hauteur déjà mesurée de la zone interrompue', () => {
    const e = jouer([...rectangle, { type: 'fermer' }, { type: 'mesurer-hauteur', point: p(0, 0, SOL + 2.7) }]);
    expect(cloturerSession(e, 250).zones[0]).toMatchObject({ hauteur: 270, hauteurMesuree: true });
  });

  it('signale les angles perdus quand la zone en cours est inutilisable', () => {
    const bilan = cloturerSession(jouer([placer(0, 0), placer(4, 0)]), 250);
    expect(bilan).toEqual({ zones: [], zoneEnCoursConservee: false, anglesPerdus: 2 });
    expect(cloturerSession(etatInitialRA(), 250)).toEqual({ zones: [], zoneEnCoursConservee: false, anglesPerdus: 0 });
  });
});

describe('outils de la colle WebXR', () => {
  it('intersection du rayon de visée avec le plan du sol', () => {
    const i = intersectionRayonSol({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: -1 }, -1.5);
    expect(i).not.toBeNull();
    expect(i!.x).toBeCloseTo(0);
    expect(i!.y).toBe(-1.5);
    expect(i!.z).toBeCloseTo(-1.5);
    // Rayon horizontal ou vers le haut : pas de sol visé.
    expect(intersectionRayonSol({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, -1.5)).toBeNull();
    expect(intersectionRayonSol({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: -1 }, -1.5)).toBeNull();
    // Trop loin (rayon presque horizontal).
    expect(intersectionRayonSol({ x: 0, y: 0, z: 0 }, { x: 0, y: -0.01, z: -1 }, -1.5)).toBeNull();
    expect(intersectionRayonSol({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, -1.5)).toBeNull();
  });

  it('reconnaît une surface de sol par sa normale (axe Y de la pose)', () => {
    const identite = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(estSurfaceSol(identite)).toBe(true);
    // Mur : normale horizontale.
    const mur = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
    expect(estSurfaceSol(mur)).toBe(false);
  });

  it('pose un segment au sol entre deux angles', () => {
    const s = poseSegment(p(0, 0), p(0, 2));
    expect(s.longueur).toBe(2);
    expect(s.milieu).toEqual({ x: 0, y: SOL, z: 1 });
    // L'axe x local tourné de rotationY doit pointer vers b : (cos θ, −sin θ) = (0, 1).
    expect(Math.cos(s.rotationY)).toBeCloseTo(0);
    expect(-Math.sin(s.rotationY)).toBeCloseTo(1);
  });

  it('traduit les erreurs de démarrage en français', () => {
    expect(messageErreurRA({ name: 'NotAllowedError' })).toMatch(/caméra refusé/);
    expect(messageErreurRA({ name: 'NotSupportedError' })).toMatch(/Services Google Play pour la RA/);
    expect(messageErreurRA({ name: 'SecurityError' })).toMatch(/https/);
    expect(messageErreurRA({ name: 'InvalidStateError' })).toMatch(/déjà en cours/);
    expect(messageErreurRA({ name: 'HitTestIndisponible' })).toMatch(/hit-test/);
    expect(messageErreurRA(new Error('panne'))).toBe('Impossible de démarrer la réalité augmentée : panne.');
    expect(messageErreurRA(undefined)).toBe('Impossible de démarrer la réalité augmentée.');
  });
});
