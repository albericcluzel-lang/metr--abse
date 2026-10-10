import { Box3, EdgesGeometry, LineSegments, Mesh, Vector3, type BufferGeometry, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { coinsEquipement } from '../../geometrie/piece';
import { catalogueParDefaut } from '../../model/catalogue';
import { nouvelEquipement, nouvelleOuverture, pieceRectangle } from '../../model/fabrique';
import type { Plan } from '../../model/types';
import { construireGroupePlan, etiquettesPieces, libererGroupe } from './scene';

const catalogue = catalogueParDefaut();
const E = 9.8; // cloison 98 mm (type par défaut)

/** Salle de bain de la vidéo (2,04 × 1,75 m) avec porte, fenêtre et baignoire. */
function planExemple(): Plan {
  const sdb = pieceRectangle('Salle de bain', 204, 175, { hauteur: 250 });
  sdb.revetementSolId = 'carrelage';
  sdb.ouvertures.push(nouvelleOuverture('porte', 2, 60)); // 83 × 204, côté bas
  sdb.ouvertures.push(nouvelleOuverture('fenetre', 0, 60, { largeur: 80 })); // côté haut
  const baignoire = nouvelEquipement('baignoire', { x: 93.5, y: 26 + 5 });
  baignoire.largeur = 187;
  baignoire.profondeur = 52;
  sdb.equipements.push(baignoire);
  return { pieces: [sdb] };
}

function maillages(o: Object3D): Mesh[] {
  const res: Mesh[] = [];
  o.traverse((x) => {
    if ((x as Mesh).isMesh) res.push(x as Mesh);
  });
  return res;
}

function nommes(o: Object3D, nom: string): Object3D[] {
  const res: Object3D[] = [];
  o.traverse((x) => {
    if (x.name === nom) res.push(x);
  });
  return res;
}

/** Triangles d'une géométrie non indexée, avec leur normale déclarée. */
function triangles(geo: BufferGeometry, groupe?: number) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  let debut = 0;
  let fin = pos.count;
  if (groupe !== undefined) {
    const g = geo.groups.find((x) => x.materialIndex === groupe)!;
    debut = g.start;
    fin = g.start + g.count;
  }
  const res: Array<{ a: Vector3; b: Vector3; c: Vector3; n: Vector3; aire: number }> = [];
  for (let i = debut; i < fin; i += 3) {
    const a = new Vector3().fromBufferAttribute(pos, i);
    const b = new Vector3().fromBufferAttribute(pos, i + 1);
    const c = new Vector3().fromBufferAttribute(pos, i + 2);
    const n = new Vector3().fromBufferAttribute(nor, i);
    const croix = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    res.push({ a, b, c, n, aire: croix.length() / 2 });
    // L'ordre des sommets correspond à la normale : la face est visible du bon côté.
    expect(croix.dot(n)).toBeGreaterThan(0);
  }
  return res;
}

describe('construction de la maquette 3D', () => {
  it('produit les maillages attendus pour une pièce avec porte, fenêtre et baignoire', () => {
    const plan = planExemple();
    const g = construireGroupePlan(plan, catalogue);
    expect(g.children).toHaveLength(1);
    const noms = maillages(g).map((m) => m.name).sort();
    expect(noms).toEqual(['cadres', 'equipement', 'murs', 'sol', 'vantaux', 'vitrages']);
    expect(nommes(g, 'aretes')).toHaveLength(1);
    expect(g.children[0].userData.pieceId).toBe(plan.pieces[0].id);
    libererGroupe(g);
  });

  it('boîte englobante : murs compris, de 0 à la hauteur sous plafond', () => {
    const g = construireGroupePlan(planExemple(), catalogue);
    const b = new Box3().setFromObject(g);
    expect(b.min.x).toBeCloseTo(-E / 100, 6);
    expect(b.min.z).toBeCloseTo(-E / 100, 6);
    expect(b.max.x).toBeCloseTo((204 + E) / 100, 6);
    expect(b.max.z).toBeCloseTo((175 + E) / 100, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(2.5, 6);
  });

  it('le sol n’est pas inversé : normales vers le haut, coins aux bonnes coordonnées', () => {
    const plan: Plan = { pieces: [pieceRectangle('Pièce', 100, 200)] };
    const sol = nommes(construireGroupePlan(plan, catalogue), 'sol')[0] as Mesh;
    const tris = triangles(sol.geometry);
    expect(tris.every((t) => t.n.y === 1)).toBe(true);
    expect(tris.reduce((s, t) => s + t.aire, 0)).toBeCloseTo(2, 6); // 1 m × 2 m
    const xs = new Set<string>();
    for (const t of tris) for (const p of [t.a, t.b, t.c]) xs.add(`${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`);
    // (100, 0) → x = 1, z = 0 ; (0, 200) → x = 0, z = 2
    expect(xs).toEqual(new Set(['0.000,0.000,0.000', '1.000,0.000,0.000', '1.000,0.000,2.000', '0.000,0.000,2.000']));
  });

  it('prend la couleur du revêtement de sol, blanc cassé sinon', () => {
    const plan = planExemple();
    const sans = pieceRectangle('Chambre', 300, 300, { origine: { x: 300, y: 0 } });
    plan.pieces.push(sans);
    const g = construireGroupePlan(plan, catalogue);
    const couleurs = nommes(g, 'sol').map((s) => `#${((s as Mesh).material as any).color.getHexString()}`);
    expect(couleurs[0]).toBe('#d9cdb8');
    expect(couleurs[1]).toBe('#efece5');
  });

  it('perce les murs : nu intérieur = périmètre × hauteur − ouvertures', () => {
    const p = pieceRectangle('Chambre', 400, 300, { hauteur: 250 });
    p.ouvertures.push(nouvelleOuverture('fenetre', 0, 150)); // 100 × 125, allège 95
    p.ouvertures.push(nouvelleOuverture('porte', 2, 50)); // 83 × 204
    const murs = nommes(construireGroupePlan({ pieces: [p] }, catalogue), 'murs')[0] as Mesh;
    const tris = triangles(murs.geometry, 0);
    // Faces tournées vers l'intérieur de la pièce, posées sur le contour intérieur.
    const surContour = (v: Vector3) =>
      Math.abs(v.x) < 1e-6 || Math.abs(v.x - 4) < 1e-6 || Math.abs(v.z) < 1e-6 || Math.abs(v.z - 3) < 1e-6;
    const versCentre = (t: (typeof tris)[number]) => {
      const m = new Vector3().add(t.a).add(t.b).add(t.c).divideScalar(3);
      return t.n.y === 0 && new Vector3(2, m.y, 1.5).sub(m).dot(t.n) > 0;
    };
    const interieur = tris.filter((t) => [t.a, t.b, t.c].every(surContour) && versCentre(t));
    const attendu = (2 * (400 + 300) * 250 - 100 * 125 - 83 * 204) / 1e4;
    expect(interieur.reduce((s, t) => s + t.aire, 0)).toBeCloseTo(attendu, 6);
    // Dessus des murs : couronne entre le contour intérieur et le contour extérieur.
    const dessus = triangles(murs.geometry, 1);
    expect(dessus.every((t) => t.n.y === 1 && Math.abs(t.a.y - 2.5) < 1e-6)).toBe(true);
    expect(dessus.reduce((s, t) => s + t.aire, 0)).toBeCloseTo(((400 + 2 * E) * (300 + 2 * E) - 400 * 300) / 1e4, 6);
  });

  it('perce aussi le mur de la pièce voisine traversé par une porte', () => {
    const a = pieceRectangle('Séjour', 400, 300);
    const b = pieceRectangle('Cuisine', 300, 300, { origine: { x: 400 + E, y: 0 } });
    a.ouvertures.push(nouvelleOuverture('passage', 1, 100, { largeur: 90, hauteur: 204 })); // côté droit du séjour
    const g = construireGroupePlan({ pieces: [a, b] }, catalogue);
    const mursCuisine = nommes(g, 'murs')[1] as Mesh;
    // Le nu intérieur gauche de la cuisine (x = 4,098) est percé de 0,90 × 2,04 m.
    const tris = triangles(mursCuisine.geometry, 0).filter(
      (t) => [t.a, t.b, t.c].every((v) => Math.abs(v.x - (400 + E) / 100) < 1e-6) && t.n.x > 0.5,
    );
    expect(tris.reduce((s, t) => s + t.aire, 0)).toBeCloseTo((300 * 250 - 90 * 204) / 1e4, 6);
  });

  it('pas d’arête parasite : sans ouverture, les arêtes verticales sont aux angles', () => {
    const p = pieceRectangle('Pièce', 400, 300);
    const g = construireGroupePlan({ pieces: [p] }, catalogue);
    const a = nommes(g, 'aretes')[0] as LineSegments;
    const pos = a.geometry.getAttribute('position');
    const angles = [
      [0, 0], [4, 0], [4, 3], [0, 3],
      [-E / 100, -E / 100], [4 + E / 100, -E / 100], [4 + E / 100, 3 + E / 100], [-E / 100, 3 + E / 100],
    ];
    let verticales = 0;
    for (let i = 0; i < pos.count; i += 2) {
      const p = new Vector3().fromBufferAttribute(pos, i);
      const q = new Vector3().fromBufferAttribute(pos, i + 1);
      if (Math.abs(p.x - q.x) > 1e-6 || Math.abs(p.z - q.z) > 1e-6) continue;
      verticales++;
      expect(angles.some(([x, z]) => Math.abs(p.x - x) < 1e-5 && Math.abs(p.z - z) < 1e-5)).toBe(true);
    }
    expect(verticales).toBeGreaterThanOrEqual(8);
    expect(a.geometry).toBeInstanceOf(EdgesGeometry);
  });

  it('côté sans mur (séparation fictive) : pas de mur, bouts des murs voisins fermés', () => {
    const p = pieceRectangle('Cuisine ouverte', 400, 300);
    p.sommets[1].typeMurId = null; // côté droit ouvert
    const murs = nommes(construireGroupePlan({ pieces: [p] }, catalogue), 'murs')[0] as Mesh;
    const tris = triangles(murs.geometry, 0);
    // Aucune face sur le côté droit intérieur x = 4 tournée vers la pièce…
    expect(tris.some((t) => [t.a, t.b, t.c].every((v) => Math.abs(v.x - 4) < 1e-6) && t.n.x < -0.5)).toBe(false);
    // …mais les bouts des murs haut et bas sont fermés par une face tournée vers +x.
    const bouts = tris.filter((t) => [t.a, t.b, t.c].every((v) => Math.abs(v.x - 4) < 1e-6) && t.n.x > 0.5);
    expect(bouts.reduce((s, t) => s + t.aire, 0)).toBeCloseTo((2 * E * 250) / 1e4, 6);
  });

  it('place les équipements à l’emplacement et à la rotation du plan', () => {
    const p = pieceRectangle('Salle d’eau', 300, 300);
    const e = nouvelEquipement('placard', { x: 150, y: 100 });
    e.rotation = 30;
    p.equipements.push(e);
    const m = nommes(construireGroupePlan({ pieces: [p] }, catalogue), 'equipement')[0] as Mesh;
    const b = new Box3().setFromObject(m);
    const coins = coinsEquipement(e);
    expect(b.min.x).toBeCloseTo(Math.min(...coins.map((c) => c.x)) / 100, 6);
    expect(b.max.x).toBeCloseTo(Math.max(...coins.map((c) => c.x)) / 100, 6);
    expect(b.min.z).toBeCloseTo(Math.min(...coins.map((c) => c.y)) / 100, 6);
    expect(b.max.z).toBeCloseTo(Math.max(...coins.map((c) => c.y)) / 100, 6);
    expect(b.max.y).toBeCloseTo(e.hauteur / 100, 6);
  });

  it('le vantail de la porte s’ouvre dans la pièce (ou vers l’extérieur si demandé)', () => {
    // Côté gauche (index 3) d'une chambre décalée : le mur est vertical, normale vers −x.
    const p = pieceRectangle('Chambre', 350, 300, { origine: { x: 213.8, y: 0 } });
    p.ouvertures.push(nouvelleOuverture('porte', 3, 15));
    const boite = (q: typeof p) =>
      new Box3().setFromObject(nommes(construireGroupePlan({ pieces: [q] }, catalogue), 'vantaux')[0]);
    const dedans = boite(p);
    // Côté charnière, l'épaisseur du vantail (4 cm) reste dans la baie.
    expect(dedans.min.x).toBeGreaterThanOrEqual(2.138 - 0.04);
    expect(dedans.max.x).toBeGreaterThan(2.138 + 0.3);
    // Le long du côté : entre 15 et 98 cm du sommet de départ (213,8 ; 300).
    expect(dedans.max.z).toBeLessThanOrEqual(3 - 0.15 + 1e-6);
    expect(dedans.min.z).toBeGreaterThanOrEqual(3 - 0.98 - 1e-6);
    const q = structuredClone(p);
    q.ouvertures[0].versInterieur = false;
    expect(boite(q).max.x).toBeLessThanOrEqual(2.138 + 0.04);
    expect(boite(q).min.x).toBeLessThan(2.04 - 0.3);
  });

  it('creuse la baignoire : fond de cuve sous le rebord', () => {
    const m = nommes(construireGroupePlan(planExemple(), catalogue), 'equipement')[0] as Mesh;
    const fond = triangles(m.geometry, 1);
    expect(fond.length).toBeGreaterThan(0);
    expect(fond.every((t) => t.n.y === 1 && t.a.y < 0.55 - 0.3)).toBe(true);
  });

  it('plan vide : groupe vide ; libération sans erreur', () => {
    const g = construireGroupePlan({ pieces: [] }, catalogue);
    expect(g.children).toHaveLength(0);
    expect(new Box3().setFromObject(g).isEmpty()).toBe(true);
    expect(() => libererGroupe(g)).not.toThrow();
  });

  it('libère toutes les géométries et tous les matériaux', () => {
    const g = construireGroupePlan(planExemple(), catalogue);
    let liberes = 0;
    g.traverse((o) => {
      const x = o as Partial<Mesh>;
      x.geometry?.addEventListener('dispose', () => liberes++);
      const m = x.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((y) => y.addEventListener('dispose', () => liberes++));
    });
    libererGroupe(g);
    expect(liberes).toBeGreaterThan(10);
  });
});

describe('étiquettes des pièces', () => {
  it('donne le nom, la surface et une position au sol dans la pièce', () => {
    const [e] = etiquettesPieces(planExemple());
    expect(e.nom).toBe('Salle de bain');
    expect(e.surface.replace(/\s/g, ' ')).toBe('3,57 m²');
    expect(e.position.x).toBeCloseTo(1.02, 6);
    expect(e.position.z).toBeCloseTo(0.875, 6);
    expect(e.position.y).toBeLessThan(0.05);
  });
});
