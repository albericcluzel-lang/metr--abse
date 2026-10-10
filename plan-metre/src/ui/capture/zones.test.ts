import { describe, expect, it } from 'vitest';
import { catalogueParDefaut } from '../../model/catalogue';
import { pieceRectangle } from '../../model/fabrique';
import type { Point } from '../../model/types';
import { aire, aireSignee, boiteEnglobante, tourner } from '../../geometrie/polygone';
import {
  angleAlignement,
  boitesDesPieces,
  construirePieces,
  grouperZones,
  lireBrouillon,
  MARGE_PLACEMENT_CM,
  nomsParDefaut,
  placerZones,
  preparerContour,
  serialiserBrouillon,
  zoneLaser,
  zoneRectangle,
  zonesDepuisRA,
  type ZoneRelevee,
} from './zones';

const rect = (x: number, y: number, l: number, h: number): Point[] => [
  { x, y },
  { x: x + l, y },
  { x: x + l, y: y + h },
  { x, y: y + h },
];

function zoneRA(points: Point[], session = 's1', hauteur = 250): ZoneRelevee {
  return { id: Math.random().toString(36).slice(2), methode: 'ra', nom: '', points, hauteur, sessionRA: session };
}

function seChevauchent(a: Point[], b: Point[]): boolean {
  const ba = boiteEnglobante(a);
  const bb = boiteEnglobante(b);
  return ba.minX < bb.maxX && bb.minX < ba.maxX && ba.minY < bb.maxY && bb.minY < ba.maxY;
}

/** Pièces écartées d'au moins la marge, emprise proche d'un carré (ni bande, ni colonne). */
function verifierDisposition(boites: ReturnType<typeof boiteEnglobante>[]) {
  for (let i = 0; i < boites.length; i++) {
    for (let j = i + 1; j < boites.length; j++) {
      const a = boites[i];
      const b = boites[j];
      const ecart = Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minY - a.maxY, a.minY - b.maxY);
      expect(ecart).toBeGreaterThanOrEqual(MARGE_PLACEMENT_CM - 0.01);
    }
  }
  const tout = boiteEnglobante(boites.flatMap((b) => [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]));
  const rapport = (tout.maxX - tout.minX) / (tout.maxY - tout.minY);
  expect(rapport).toBeGreaterThan(0.6);
  expect(rapport).toBeLessThan(1.6);
  // Pas de place perdue : l'emprise reste proche de la somme des pièces et de leurs marges.
  const surfaces = boites.reduce((s, b) => s + (b.maxX - b.minX + MARGE_PLACEMENT_CM) * (b.maxY - b.minY + MARGE_PLACEMENT_CM), 0);
  expect((tout.maxX - tout.minX) * (tout.maxY - tout.minY)).toBeLessThan(surfaces * 1.6);
}

describe('création des zones', () => {
  it('rectangle : longueur sur x, largeur sur y', () => {
    const z = zoneRectangle('  Cuisine ', 250, 200, 240);
    expect(z).toMatchObject({ methode: 'rectangle', nom: 'Cuisine', hauteur: 240 });
    expect(z.points).toEqual(rect(0, 0, 250, 200));
  });

  it('réalité augmentée : conversion m → cm et session commune', () => {
    const zones = zonesDepuisRA(
      [
        {
          id: 4,
          angles: [
            { id: 1, x: 0, y: -1.4, z: 0 },
            { id: 2, x: 1, y: -1.4, z: 0 },
            { id: 3, x: 1, y: -1.4, z: 1 },
          ],
          sol: -1.4,
          hauteur: 250,
          hauteurMesuree: true,
        },
      ],
      'session-a',
    );
    expect(zones[0]).toMatchObject({ id: 'session-a-4', methode: 'ra', sessionRA: 'session-a', hauteur: 250 });
    expect(zones[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it('regroupe les zones d’une même session de réalité augmentée', () => {
    const a = zoneRA(rect(0, 0, 100, 100), 's1');
    const b = zoneLaser(rect(0, 0, 100, 100), 250);
    const c = zoneRA(rect(200, 0, 100, 100), 's1');
    const d = zoneRA(rect(0, 0, 100, 100), 's2');
    expect(grouperZones([a, b, c, d]).map((g) => g.map((z) => z.id))).toEqual([[a.id, c.id], [b.id], [d.id]]);
  });
});

describe('alignement et redressement', () => {
  it('aligne le plus long côté sur l’axe x avec la plus petite rotation', () => {
    const pts = rect(0, 0, 400, 300).map((p) => tourner(p, (20 * Math.PI) / 180));
    expect(angleAlignement(pts)).toBeCloseTo((-20 * Math.PI) / 180);
    // Côté le plus long presque « vers la gauche » : on ne retourne pas la pièce.
    const inverse = rect(0, 0, 400, 300).map((p) => tourner(p, (170 * Math.PI) / 180));
    expect(angleAlignement(inverse)).toBeCloseTo((10 * Math.PI) / 180);
    // Côté le plus long vertical : quart de tour.
    expect(Math.abs(angleAlignement(rect(0, 0, 100, 500)))).toBeCloseTo(Math.PI / 2);
  });

  it('redresse un relevé approximatif en angles droits exacts', () => {
    const approx = [
      { x: 0, y: 0 },
      { x: 401, y: 4 },
      { x: 398, y: 302 },
      { x: -3, y: 298 },
    ];
    const r = preparerContour(approx, true);
    expect(r).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      const a = r[i];
      const b = r[(i + 1) % 4];
      // Chaque côté est horizontal ou vertical (au mm près).
      expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThanOrEqual(0.15);
    }
    expect(Math.abs(aire(r) / 10000 - 12)).toBeLessThan(0.1);
  });

  it('retire un angle posé au milieu d’un mur lors du redressement', () => {
    const r = preparerContour([{ x: 0, y: 0 }, { x: 200, y: 2 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }], true);
    expect(r).toHaveLength(4);
  });

  it('sans redressement : contour conservé, remis dans le sens horaire', () => {
    const anti = [...rect(0, 0, 400, 300)].reverse();
    const r = preparerContour(anti, false);
    expect(aireSignee(r)).toBeGreaterThan(0);
    expect(aire(r)).toBe(120000);
  });
});

describe('placement des zones', () => {
  it('plan vide : zones laser / rectangle rangées depuis l’origine, à la marge l’une de l’autre', () => {
    const a = zoneLaser(rect(0, 0, 400, 300), 250);
    const b = zoneRectangle('', 250, 200, 250);
    const r = placerZones([a, b], { redresser: false, existantes: [] });
    expect(r.map((x) => x.zone.id)).toEqual([a.id, b.id]);
    expect(boiteEnglobante(r[0].points)).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 300 });
    // Plus ramassé l'une sous l'autre (400 × 600) que côte à côte (750 × 300).
    expect(boiteEnglobante(r[1].points)).toEqual({ minX: 0, minY: 300 + MARGE_PLACEMENT_CM, maxX: 250, maxY: 600 });
    expect(seChevauchent(r[0].points, r[1].points)).toBe(false);
    expect(aire(r[0].points)).toBe(120000);
    expect(aire(r[1].points)).toBe(50000);
  });

  it('plan occupé : dans la première place libre à la marge des pièces existantes', () => {
    // Deux pièces existantes en L : la place libre à droite de la première est prise.
    const existantes = [
      { minX: -50, minY: 20, maxX: 350, maxY: 320 },
      { minX: -50, minY: 420, maxX: 800, maxY: 900 },
    ];
    const r = placerZones([zoneRectangle('', 300, 300, 250)], { redresser: false, existantes });
    expect(boiteEnglobante(r[0].points)).toEqual({ minX: 450, minY: 20, maxX: 750, maxY: 320 });
    // Plus de place à côté : en dessous, aligné à gauche.
    const pleine = [{ minX: -50, minY: 20, maxX: 600, maxY: 500 }];
    const r2 = placerZones([zoneRectangle('', 300, 300, 250)], { redresser: false, existantes: pleine });
    expect(boiteEnglobante(r2[0].points)).toEqual({ minX: -50, minY: 600, maxX: 250, maxY: 900 });
  });

  it('réalité augmentée : même session = positions relatives gardées, groupe aligné', () => {
    // Deux pièces voisines relevées en biais (30°) dans le repère de la session.
    const angle = (30 * Math.PI) / 180;
    const sejour = rect(-500, 200, 500, 400).map((p) => tourner(p, angle));
    const cuisine = rect(10, 200, 300, 400).map((p) => tourner(p, angle));
    const a = zoneRA(sejour);
    const b = zoneRA(cuisine);
    const r = placerZones([a, b], { redresser: false, existantes: [] });
    const [pa, pb] = r.map((x) => x.points);
    // Le plus long côté de la première zone est sur l'axe x.
    expect(Math.abs(pa[0].y - pa[1].y)).toBeLessThan(0.15);
    // Le groupe démarre à l'origine.
    const b0 = boiteEnglobante([...pa, ...pb]);
    expect(b0.minX).toBeCloseTo(0, 0);
    expect(b0.minY).toBeCloseTo(0, 0);
    // La cuisine reste à 10 cm à droite du séjour (cloison) et à la même hauteur.
    expect(boiteEnglobante(pb).minX - boiteEnglobante(pa).maxX).toBeCloseTo(10, 0);
    expect(boiteEnglobante(pb).minY).toBeCloseTo(boiteEnglobante(pa).minY, 0);
    expect(seChevauchent(pa, pb)).toBe(false);
    expect(aire(pa)).toBeCloseTo(200000, -1);
  });

  it('réalité augmentée redressée : pièces d’équerre sur les axes, positions relatives gardées', () => {
    const angle = (12 * Math.PI) / 180;
    const bruit = (pts: Point[]) => pts.map((p, i) => ({ x: p.x + (i % 2 ? 2 : -1.5), y: p.y + (i % 3 ? -1 : 2) }));
    const a = zoneRA(bruit(rect(0, 0, 500, 400)).map((p) => tourner(p, angle)));
    const b = zoneRA(bruit(rect(510, 0, 300, 400)).map((p) => tourner(p, angle)));
    const r = placerZones([a, b], { redresser: true, existantes: [] });
    for (const { points } of r) {
      expect(points).toHaveLength(4);
      for (let i = 0; i < 4; i++) {
        const p = points[i];
        const q = points[(i + 1) % 4];
        expect(Math.min(Math.abs(p.x - q.x), Math.abs(p.y - q.y))).toBeLessThanOrEqual(0.15);
      }
    }
    const ecart = boiteEnglobante(r[1].points).minX - boiteEnglobante(r[0].points).maxX;
    expect(ecart).toBeGreaterThan(0);
    expect(ecart).toBeLessThan(20);
  });

  it('sessions différentes et zones laser : groupes posés côte à côte sans chevauchement', () => {
    const zones = [
      zoneRA(rect(0, 0, 300, 300), 's1'),
      zoneRA(rect(310, 0, 200, 300), 's1'),
      zoneRA(rect(0, 0, 250, 250), 's2'),
      zoneLaser(rect(0, 0, 400, 300), 250),
    ];
    const existant = { minX: 0, minY: 0, maxX: 500, maxY: 400 };
    const r = placerZones(zones, { redresser: false, existantes: [existant] });
    for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j < r.length; j++) expect(seChevauchent(r[i].points, r[j].points)).toBe(false);
    }
    // Les deux pièces de la session s1 restent côte à côte (10 cm).
    expect(boiteEnglobante(r[1].points).minX - boiteEnglobante(r[0].points).maxX).toBe(10);
    verifierDisposition([existant, boiteEnglobante([...r[0].points, ...r[1].points]), ...r.slice(2).map((x) => boiteEnglobante(x.points))]);
  });

  it('beaucoup de pièces : rangées compactes et lisibles, pas une seule bande', () => {
    const zones = Array.from({ length: 30 }, (_, i) => zoneRectangle('', 300 + ((i * 37) % 161), 250 + ((i * 53) % 101), 250));
    const r = placerZones(zones, { redresser: false, existantes: [] });
    verifierDisposition(r.map((x) => boiteEnglobante(x.points)));
  });

  it('écran en portrait : rangées plus étroites, ensemble plus haut que large', () => {
    const zones = Array.from({ length: 30 }, (_, i) => zoneRectangle('', 300 + ((i * 37) % 161), 250 + ((i * 53) % 101), 250));
    const r = placerZones(zones, { redresser: false, existantes: [], rapport: 0.5 });
    const b = boiteEnglobante(r.flatMap((x) => x.points));
    const rapport = (b.maxX - b.minX) / (b.maxY - b.minY);
    expect(rapport).toBeGreaterThan(0.35);
    expect(rapport).toBeLessThan(0.75);
  });

  it('pièces ajoutées une à une (un relevé par pièce) : la disposition reste compacte', () => {
    const boites: ReturnType<typeof boiteEnglobante>[] = [];
    for (let i = 0; i < 30; i++) {
      const zone = zoneRectangle('', 300 + ((i * 37) % 161), 250 + ((i * 53) % 101), 250);
      const [placee] = placerZones([zone], { redresser: false, existantes: boites });
      boites.push(boiteEnglobante(placee.points));
    }
    verifierDisposition(boites);
  });

  it('boîtes des pièces existantes : murs compris', () => {
    const cat = catalogueParDefaut();
    const p = pieceRectangle('A', 400, 300); // cloison 98 mm par défaut
    const [b] = boitesDesPieces([p], cat);
    expect(b.minX).toBeCloseTo(-9.8);
    expect(b.maxX).toBeCloseTo(409.8);
    expect(boitesDesPieces([], cat)).toEqual([]);
  });
});

describe('pièces créées', () => {
  it('reprend les noms, hauteurs et type de mur choisis', () => {
    const a = zoneLaser(rect(0, 0, 400, 300), 250);
    const b = zoneRectangle('Cuisine', 250, 200, 250);
    const placees = placerZones([a, b], { redresser: false, existantes: [] });
    const pieces = construirePieces(placees, {
      noms: { [a.id]: ' Séjour ' },
      hauteurs: { [b.id]: 270 },
      typeMurDefautId: 'cloison-72',
    });
    expect(pieces.map((p) => p.nom)).toEqual(['Séjour', 'Cuisine']);
    expect(pieces.map((p) => p.hauteur)).toEqual([250, 270]);
    expect(pieces.every((p) => p.typeMurDefautId === 'cloison-72')).toBe(true);
    expect(pieces[0].id).not.toBe(pieces[1].id);
    expect(construirePieces(placees.slice(0, 1), { noms: { [a.id]: '  ' }, hauteurs: {}, typeMurDefautId: 'x' })[0].nom).toBe(
      'Pièce 1',
    );
  });

  it('noms par défaut sans doublon avec le plan', () => {
    expect(nomsParDefaut(3, ['Pièce 2', 'pièce 3'])).toEqual(['Pièce 1', 'Pièce 4', 'Pièce 5']);
    expect(nomsParDefaut(0, [])).toEqual([]);
  });
});

describe('brouillon du relevé', () => {
  it('relit ce qui a été écrit', () => {
    const zones = [zoneRA(rect(0, 0, 100, 100)), zoneRectangle('WC', 100, 150, 250)];
    expect(lireBrouillon(serialiserBrouillon(zones))).toEqual(zones);
  });

  it('ignore un brouillon absent, illisible ou d’une autre version', () => {
    expect(lireBrouillon(null)).toEqual([]);
    expect(lireBrouillon('{pas du json')).toEqual([]);
    expect(lireBrouillon(JSON.stringify({ version: 99, zones: [] }))).toEqual([]);
    expect(lireBrouillon('42')).toEqual([]);
  });

  it('écarte les zones mal formées', () => {
    const ok = zoneRectangle('A', 100, 100, 250);
    const texte = JSON.stringify({
      version: 1,
      zones: [ok, { ...ok, id: 3 }, { ...ok, points: [{ x: 0, y: 0 }] }, { ...ok, hauteur: -1 }, { ...ok, methode: 'x' }, null],
    });
    expect(lireBrouillon(texte)).toEqual([ok]);
  });
});
