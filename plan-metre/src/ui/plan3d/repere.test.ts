import { Box3, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { tourner } from '../../geometrie/polygone';
import { calculerCadrage, directionVersScene, rotationVersScene, versPlan, versScene, type Point3 } from './repere';

const v3 = (p: Point3) => new Vector3(p.x, p.y, p.z);

describe('repère plan → scène', () => {
  it('convertit les cm du plan en m, Y vertical, sans miroir', () => {
    expect(versScene({ x: 100, y: 0 })).toEqual({ x: 1, y: 0, z: 0 });
    expect(versScene({ x: 0, y: 100 })).toEqual({ x: 0, y: 0, z: 1 });
    expect(versScene({ x: 250, y: -50 }, 250)).toEqual({ x: 2.5, y: 2.5, z: -0.5 });
    expect(versPlan({ x: 1.5, y: 3, z: 2 })).toEqual({ x: 150, y: 200 });
  });

  it('vu de dessus, la scène se lit comme le plan (repère direct conservé)', () => {
    // Caméra au-dessus, haut de l'écran vers −Z : x du plan à droite, y du plan vers le bas.
    const cam = new PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(0, 10, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const droite = v3(versScene({ x: 100, y: 0 })).project(cam);
    const bas = v3(versScene({ x: 0, y: 100 })).project(cam);
    expect(droite.x).toBeGreaterThan(0); // à droite de l'écran
    expect(Math.abs(droite.y)).toBeLessThan(1e-9);
    expect(bas.y).toBeLessThan(0); // en bas de l'écran (NDC y vers le haut)
    expect(Math.abs(bas.x)).toBeLessThan(1e-9);
  });

  it('les directions et rotations suivent le même repère', () => {
    expect(directionVersScene({ x: 0, y: -1 })).toEqual({ x: 0, y: 0, z: -1 });
    // Un objet tourné de 30° dans le plan (sens horaire à l'écran) : même résultat
    // avec la rotation de la scène autour de Y.
    const o = new Object3D();
    o.rotation.y = rotationVersScene(30);
    o.updateMatrixWorld();
    const local = { x: 100, y: 40 };
    const attendu = versScene(tourner(local, (30 * Math.PI) / 180));
    const obtenu = new Vector3(local.x / 100, 0, local.y / 100).applyMatrix4(o.matrixWorld);
    expect(obtenu.x).toBeCloseTo(attendu.x, 9);
    expect(obtenu.z).toBeCloseTo(attendu.z, 9);
  });
});

describe('cadrage automatique', () => {
  function verifier(boite: Box3, aspect: number) {
    const fov = 45;
    const c = calculerCadrage(boite, aspect, fov, { marge: 1.1 });
    const cam = new PerspectiveCamera(fov, aspect, 0.01, 1000);
    cam.position.copy(c.position);
    cam.lookAt(c.cible);
    cam.updateMatrixWorld();
    let maxi = 0;
    for (let i = 0; i < 8; i++) {
      const coin = new Vector3(
        i & 1 ? boite.max.x : boite.min.x,
        i & 2 ? boite.max.y : boite.min.y,
        i & 4 ? boite.max.z : boite.min.z,
      ).project(cam);
      expect(Math.abs(coin.x)).toBeLessThanOrEqual(1 / 1.1 + 1e-9);
      expect(Math.abs(coin.y)).toBeLessThanOrEqual(1 / 1.1 + 1e-9);
      maxi = Math.max(maxi, Math.abs(coin.x), Math.abs(coin.y));
    }
    // Ajusté au plus juste : au moins un coin touche la marge.
    expect(maxi).toBeCloseTo(1 / 1.1, 6);
    // Vue plongeante : la caméra est au-dessus de la cible.
    expect(c.position.y).toBeGreaterThan(c.cible.y);
  }

  it('fait tenir la boîte en portrait (téléphone) et en paysage (PC)', () => {
    const boite = new Box3(new Vector3(-0.1, 0, -0.1), new Vector3(6, 2.5, 4));
    verifier(boite, 412 / 600);
    verifier(boite, 1366 / 650);
  });

  it('cible le centre de la boîte ; repli raisonnable si la boîte est vide', () => {
    const boite = new Box3(new Vector3(0, 0, 0), new Vector3(2, 2.5, 4));
    expect(calculerCadrage(boite, 1, 45).cible.toArray()).toEqual([1, 1.25, 2]);
    const vide = calculerCadrage(new Box3(), 1, 45);
    expect(vide.cible.toArray()).toEqual([0, 0, 0]);
    expect(vide.distance).toBeGreaterThan(0);
  });
});
