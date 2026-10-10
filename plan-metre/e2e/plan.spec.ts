import { expect, test, type Page } from '@playwright/test';
import { creerChantier } from './outils';

// Les points sont donnés en cm dans le repère du plan, puis convertis en
// pixels avec la vue courante (exposée par le SVG en attributs data-*).

interface Point {
  x: number;
  y: number;
}

const tactile = () => test.info().project.name === 'android';

async function lireVue(page: Page) {
  return page.locator('svg.plan2d-svg').evaluate((el) => {
    const d = (el as SVGSVGElement).dataset;
    return { echelle: Number(d.echelle), tx: Number(d.tx), ty: Number(d.ty) };
  });
}

async function versEcran(page: Page, p: Point): Promise<Point> {
  // Laisse passer un éventuel recadrage (fait à l'image suivante).
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const boite = (await page.locator('svg.plan2d-svg').boundingBox())!;
  const v = await lireVue(page);
  return { x: boite.x + v.tx + p.x * v.echelle, y: boite.y + v.ty + p.y * v.echelle };
}

async function toucher(page: Page, p: Point) {
  const e = await versEcran(page, p);
  if (tactile()) await page.touchscreen.tap(e.x, e.y);
  else await page.mouse.click(e.x, e.y);
}

/** Évènements tactiles bruts (Chrome DevTools) : un ou plusieurs doigts, du départ à l'arrivée. */
async function doigts(page: Page, departs: Point[], arrivees: Point[], etapes = 8) {
  const cdp = await page.context().newCDPSession(page);
  const a = (k: number) =>
    departs.map((d, i) => ({ x: d.x + ((arrivees[i].x - d.x) * k) / etapes, y: d.y + ((arrivees[i].y - d.y) * k) / etapes, id: i }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: a(0) });
  for (let k = 1; k <= etapes; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: a(k) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Glisser d'un point à un autre de l'écran (px), au doigt ou à la souris. */
async function glisserEcran(page: Page, p0: Point, p1: Point) {
  if (tactile()) {
    await doigts(page, [p0], [p1]);
  } else {
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.down();
    await page.mouse.move(p1.x, p1.y, { steps: 8 });
    await page.mouse.up();
  }
}

async function glisser(page: Page, de: Point, a: Point) {
  await glisserEcran(page, await versEcran(page, de), await versEcran(page, a));
}

/** Sommets [x, y] de la pièce `i` du plan actuel du premier niveau. */
function sommets(page: Page, i: number): Promise<number[][]> {
  return page.evaluate(
    (i) => (window as any).__etat.getState().projet.niveaux[0].actuel.pieces[i].sommets.map((s: Point) => [s.x, s.y]),
    i,
  );
}

/** Touche un endroit vide du plan : ni pièce ni mur à moins de 24 px, ni commande par-dessus. */
async function toucherLeVide(page: Page) {
  const boite = (await page.locator('svg.plan2d-svg').boundingBox())!;
  const p = await page.evaluate((b) => {
    const vide = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      return !!el && (el.matches('svg.plan2d-svg') || !!el.closest('.plan2d-grille'));
    };
    for (let j = 1; j < 24; j++) {
      for (let i = 1; i < 12; i++) {
        const x = b.x + (b.width * i) / 12;
        const y = b.y + (b.height * j) / 24;
        if ([[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24]].every(([dx, dy]) => vide(x + dx, y + dy))) return { x, y };
      }
    }
    return null;
  }, boite);
  if (!p) throw new Error('Aucun endroit vide sur le plan');
  if (tactile()) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

async function attendreEnregistrement(page: Page) {
  await page.waitForFunction(() => (window as any).__etat.getState().enregistrement === 'enregistre');
}

test('dessiner une pièce, la modifier, annuler / rétablir et la retrouver après rechargement', async ({ page }) => {
  const id = await creerChantier(page, 'Plan e2e');
  await page.goto(`./#/chantier/${id}`);
  await expect(page.getByText('Aucune pièce sur ce niveau')).toBeVisible();
  await page.locator('.plan2d-vide').getByRole('button', { name: 'Dessiner une pièce' }).click();

  // Les 4 angles d'un rectangle de 400 × 300 cm (aimantation grille / angle droit).
  await toucher(page, { x: -200, y: -150 });
  await toucher(page, { x: 201, y: -152 });
  await toucher(page, { x: 198, y: 151 });
  await toucher(page, { x: -199, y: 149 });
  await expect(page.getByText('4 points')).toBeVisible();
  await page.getByRole('button', { name: 'Fermer la pièce' }).click();
  await page.getByLabel('Nom de la pièce').fill('Chambre');
  await page.getByRole('button', { name: 'Créer la pièce' }).click();

  const etiquette = page.locator('[data-etiquette]');
  await expect(etiquette).toHaveCount(1);
  await expect(etiquette).toContainText('Chambre');
  await expect(etiquette).toContainText('12,00 m²');
  await expect(page.locator('.plan2d-cote', { hasText: '400 cm' })).toHaveCount(2);

  // Renommer (la pièce créée est sélectionnée).
  const panneau = page.locator('.plan2d-proprietes');
  await panneau.getByLabel('Nom', { exact: true }).fill('Salon');
  await expect(etiquette).toContainText('Salon');

  // Changer la longueur du mur du haut : 400 → 450 cm, les angles restent droits.
  await toucher(page, { x: 0, y: -154 });
  await expect(page.getByRole('heading', { name: 'Côté 1 · Salon' })).toBeVisible();
  const longueur = panneau.getByLabel('Longueur');
  await expect(longueur).toHaveValue('400');
  await longueur.fill('450');
  await longueur.press('Enter');
  await expect(etiquette).toContainText('13,50 m²');
  await expect(page.locator('.plan2d-cote', { hasText: '450 cm' })).toHaveCount(2);

  // Ajouter une porte au milieu du côté.
  await panneau.getByRole('button', { name: 'Ajouter une porte' }).click();
  await expect(page.locator('[data-ouverture][data-type="porte"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Porte · Salon' })).toBeVisible();

  // Annuler (porte, puis longueur) et rétablir.
  const annuler = page.getByRole('button', { name: 'Annuler', exact: true });
  const retablir = page.getByRole('button', { name: 'Rétablir', exact: true });
  await annuler.click();
  await expect(page.locator('[data-ouverture]')).toHaveCount(0);
  await annuler.click();
  await expect(etiquette).toContainText('12,00 m²');
  await retablir.click();
  await expect(etiquette).toContainText('13,50 m²');
  await retablir.click();
  await expect(page.locator('[data-ouverture][data-type="porte"]')).toHaveCount(1);

  // Tout est conservé après rechargement.
  await attendreEnregistrement(page);
  await page.reload();
  await expect(etiquette).toHaveCount(1);
  await expect(etiquette).toContainText('Salon');
  await expect(etiquette).toContainText('13,50 m²');
  await expect(page.locator('[data-ouverture][data-type="porte"]')).toHaveCount(1);
  await expect(page.locator('.plan2d-cote', { hasText: '450 cm' })).toHaveCount(2);
});

test('outils ouverture et équipement, glisser un sommet, zoom', async ({ page }) => {
  const id = await creerChantier(
    page,
    'Outils e2e',
    `projet.niveaux[0].actuel.pieces.push(
      fabrique.pieceRectangle('Cuisine', 400, 300, { origine: { x: -200, y: -150 } }),
      fabrique.pieceRectangle('Cellier', 200, 150, { origine: { x: 240, y: -150 } }),
    );`,
  );
  await page.goto(`./#/chantier/${id}`);
  const etiquette = page.locator('[data-etiquette]').filter({ hasText: 'Cuisine' });
  await expect(etiquette).toContainText('Cuisine');
  await expect(etiquette).toContainText('12,00 m²');

  // Outil Ouverture : une fenêtre sur le mur du haut.
  await page.getByRole('button', { name: 'Ajouter une ouverture' }).click();
  await page.getByRole('button', { name: 'Fenêtre', exact: true }).click();
  await toucher(page, { x: 0, y: -154 });
  await expect(page.locator('[data-ouverture][data-type="fenetre"]')).toHaveCount(1);

  // Outil Équipement : un évier, plaqué contre le mur du bas.
  await page.getByRole('button', { name: 'Ajouter un équipement' }).click();
  await page.getByRole('button', { name: 'Meuble évier' }).click();
  await toucher(page, { x: 0, y: 115 });
  await expect(page.locator('[data-equipement][data-type="evier"]')).toHaveCount(1);
  const evier = await page.evaluate(() => {
    const e = (window as any).__etat.getState();
    return e.projet.niveaux[0].actuel.pieces[0].equipements[0];
  });
  expect(evier).toMatchObject({ x: 0, y: 120, rotation: 180 });

  // Sélectionner la pièce puis glisser le coin bas-droit de 50 cm : une seule étape d'annulation.
  await toucher(page, { x: -100, y: -20 });
  await expect(page.getByRole('heading', { name: 'Cuisine', exact: true })).toBeVisible();
  await glisser(page, { x: 200, y: 150 }, { x: 250, y: 150 });
  await expect(etiquette).toContainText('12,75 m²');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(etiquette).toContainText('12,00 m²');
  await expect(page.locator('[data-equipement]')).toHaveCount(1);

  // Déplacer le cellier vers la cuisine : à moins de 15 cm, il se cale contre la face
  // extérieure du mur (cloison de 9,8 cm), en une seule étape d'annulation.
  const xCellier = () =>
    page.evaluate(() => (window as any).__etat.getState().projet.niveaux[0].actuel.pieces[1].sommets[0].x as number);
  await toucher(page, { x: 340, y: -100 });
  await expect(page.getByRole('heading', { name: 'Cellier', exact: true })).toBeVisible();
  await glisser(page, { x: 340, y: -100 }, { x: 315, y: -100 });
  await expect.poll(xCellier).toBeCloseTo(209.8, 6);
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect.poll(xCellier).toBe(240);

  // Zoom : pincer à deux doigts (téléphone) ou molette (PC), puis « Ajuster la vue ».
  // Toucher le vide désélectionne et referme le panneau.
  await toucherLeVide(page);
  await expect(page.locator('.plan2d-proprietes')).toHaveCount(0);
  const avant = (await lireVue(page)).echelle;
  const centre = await versEcran(page, { x: 0, y: -60 });
  if (tactile()) {
    await doigts(
      page,
      [
        { x: centre.x - 30, y: centre.y },
        { x: centre.x + 30, y: centre.y },
      ],
      [
        { x: centre.x - 90, y: centre.y },
        { x: centre.x + 90, y: centre.y },
      ],
    );
  } else {
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -400);
  }
  await expect.poll(async () => (await lireVue(page)).echelle).toBeGreaterThan(avant * 1.5);
  await page.getByRole('button', { name: 'Ajuster la vue' }).click();
  await expect.poll(async () => (await lireVue(page)).echelle).toBeCloseTo(avant, 3);

  if (!tactile()) {
    // Clavier : Suppr retire la fenêtre sélectionnée, Échap désélectionne.
    await toucher(page, { x: 0, y: -154 });
    await expect(page.getByRole('heading', { name: 'Fenêtre · Cuisine' })).toBeVisible();
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-ouverture]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.plan2d-panneau')).toHaveCount(0);
  }
});

test('glisser une pièce petite à l’écran depuis son intérieur la déplace sans la déformer', async ({ page }) => {
  const id = await creerChantier(
    page,
    'Petites pièces e2e',
    `projet.niveaux[0].actuel.pieces.push(
      fabrique.pieceRectangle('Séjour', 500, 400),
      fabrique.pieceRectangle('Cuisine', 350, 280, { origine: { x: 600, y: 0 } }),
      fabrique.pieceRectangle('WC', 100, 150, { origine: { x: 1000, y: 0 } }),
    );`,
  );
  await page.goto(`./#/chantier/${id}`);
  await expect(page.locator('[data-etiquette]').filter({ hasText: 'Cuisine' })).toHaveCount(1);
  // La cuisine fait moins de 64 px de haut à l'écran, comme sur un téléphone après un relevé.
  while ((await lireVue(page)).echelle * 280 > 64) await page.getByRole('button', { name: 'Zoom arrière' }).click();
  await toucher(page, { x: 775, y: 140 });
  await expect(page.getByRole('heading', { name: 'Cuisine', exact: true })).toBeVisible();
  const avant = await sommets(page, 1);
  // Doigt posé dans la cuisine, à 18 px de son coin bas-gauche : dans le rayon de la poignée du sommet.
  const coin = await versEcran(page, { x: 600, y: 280 });
  const depart = { x: coin.x + 14, y: coin.y - 12 };
  await glisserEcran(page, depart, { x: depart.x + 60, y: depart.y + 40 });
  await expect.poll(async () => JSON.stringify(await sommets(page, 1))).not.toBe(JSON.stringify(avant));
  const apres = await sommets(page, 1);
  const [dx, dy] = [apres[0][0] - avant[0][0], apres[0][1] - avant[0][1]];
  expect(apres).toEqual(avant.map(([x, y]) => [x + dx, y + dy]));
  await expect(page.getByRole('heading', { name: 'Cuisine', exact: true })).toBeVisible();
});

test('panneau d’un équipement : la ligne Rotation tient dans la largeur du panneau', async ({ page }) => {
  const id = await creerChantier(
    page,
    'Rotation e2e',
    `const sdb = fabrique.pieceRectangle('Salle de bain', 300, 250);
    sdb.equipements.push(fabrique.nouvelEquipement('baignoire', { x: 150, y: 35 }));
    projet.niveaux[0].actuel.pieces.push(sdb);`,
  );
  await page.goto(`./#/chantier/${id}`);
  await toucher(page, { x: 150, y: 35 });
  await expect(page.getByRole('heading', { name: 'Baignoire' })).toBeVisible();
  const panneau = page.locator(tactile() ? '.feuille' : '.plan2d-panneau');
  const plus = page.getByRole('button', { name: 'Tourner de 90° vers la droite' });
  const bp = (await panneau.boundingBox())!;
  for (const b of [plus, page.getByRole('button', { name: 'Tourner de 90° vers la gauche' })]) {
    const bb = (await b.boundingBox())!;
    expect(bb.x).toBeGreaterThanOrEqual(bp.x);
    expect(bb.x + bb.width).toBeLessThanOrEqual(bp.x + bp.width);
  }
  // Rien ne défile en largeur.
  const corps = page.locator(tactile() ? '.feuille-corps' : '.plan2d-panneau-corps');
  expect(await corps.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test('changer de niveau revient à l’outil Sélection et propose de relever ou dessiner', async ({ page }) => {
  const id = await creerChantier(
    page,
    'Niveaux e2e',
    `projet.niveaux[0].actuel.pieces.push(fabrique.pieceRectangle('Séjour', 400, 300));`,
  );
  await page.goto(`./#/chantier/${id}`);
  const outil = page.getByRole('button', { name: 'Ajouter un équipement' });
  await outil.click();
  await page.getByRole('button', { name: 'WC', exact: true }).click();
  await expect(outil).toHaveAttribute('aria-pressed', 'true');
  await toucher(page, { x: 700, y: 150 }); // hors des pièces : rien n'est posé, l'outil reste actif
  await expect(outil).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Niveau', { exact: true }).selectOption('__ajouter__');
  await page.getByRole('dialog', { name: 'Nouveau niveau' }).getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByText('Aucune pièce sur ce niveau')).toBeVisible();
  await expect(outil).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('group', { name: 'Type d’équipement' })).toHaveCount(0);
});

test('outils ouverture et équipement : tous les types se voient sans défiler', async ({ page }) => {
  const id = await creerChantier(
    page,
    'Types e2e',
    `projet.niveaux[0].actuel.pieces.push(fabrique.pieceRectangle('Séjour', 400, 300));`,
  );
  await page.goto(`./#/chantier/${id}`);
  const vp = page.viewportSize()!;
  for (const [outil, groupe, nombre, choix] of [
    ['Ajouter un équipement', 'Type d’équipement', 11, 'WC'],
    ['Ajouter une ouverture', 'Type d’ouverture', 5, 'Baie'],
  ] as const) {
    await page.getByRole('button', { name: outil }).click();
    const types = page.getByRole('group', { name: groupe });
    const boutons = types.getByRole('button');
    await expect(boutons).toHaveCount(nombre);
    const boite = (await types.boundingBox())!;
    for (const b of await boutons.all()) {
      const bb = (await b.boundingBox())!;
      expect(bb.height).toBeGreaterThanOrEqual(44);
      // Ni coupé par la liste, ni hors de l'écran.
      expect(bb.x).toBeGreaterThanOrEqual(Math.max(0, boite.x) - 0.5);
      expect(bb.x + bb.width).toBeLessThanOrEqual(Math.min(vp.width, boite.x + boite.width) + 0.5);
      expect(bb.y + bb.height).toBeLessThanOrEqual(vp.height);
    }
    await types.getByRole('button', { name: choix, exact: true }).click();
    if (tactile()) {
      // Téléphone : la feuille se referme et le bandeau rappelle le type choisi.
      await expect(types).toHaveCount(0);
      await expect(page.getByRole('button', { name: groupe + ' : ' + choix })).toBeVisible();
    } else {
      await expect(types.getByRole('button', { name: choix, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
  }
});

test('la feuille de propriétés laisse la barre du bas utilisable, même au retour de la 3D', async ({ page }) => {
  const id = await creerChantier(
    page,
    'Barre du bas e2e',
    `projet.niveaux[0].actuel.pieces.push(fabrique.pieceRectangle('Cuisine', 350, 280));`,
  );
  await page.goto(`./#/chantier/${id}`);
  await toucher(page, { x: 175, y: -4 });
  const titre = page.getByRole('heading', { name: 'Côté 1 · Cuisine' });
  await expect(titre).toBeVisible();
  await page.getByRole('button', { name: 'Vue 3D' }).click();
  await page.getByRole('button', { name: 'Plan 2D' }).click();
  await expect(titre).toBeVisible();
  const nav = page.locator('.nav-bas');
  for (const nom of ['Photos', 'Ajouter une pièce', 'Métré']) {
    const bb = (await nav.getByRole('button', { name: nom }).boundingBox())!;
    const libre = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest('.nav-bas'),
      [bb.x + bb.width / 2, bb.y + bb.height / 2],
    );
    expect(libre, nom).toBe(true);
  }
  await nav.getByRole('button', { name: 'Photos' }).click();
  await expect(page).toHaveURL(/photos/);
});

test('une seule feuille à la fois : « Nouveau niveau » ferme la sélection', async ({ page }) => {
  const id = await creerChantier(
    page,
    'Feuilles e2e',
    `const sdb = fabrique.pieceRectangle('Salle de bain', 300, 250);
    sdb.equipements.push(fabrique.nouvelEquipement('baignoire', { x: 150, y: 35 }));
    projet.niveaux[0].actuel.pieces.push(sdb);`,
  );
  await page.goto(`./#/chantier/${id}`);
  await toucher(page, { x: 150, y: 35 });
  await expect(page.getByRole('heading', { name: 'Baignoire' })).toBeVisible();
  await page.getByLabel('Niveau', { exact: true }).selectOption('__ajouter__');
  await expect(page.getByRole('dialog', { name: 'Nouveau niveau' })).toBeVisible();
  await expect(page.locator('.plan2d-proprietes')).toHaveCount(0);
  await expect(page.locator('.feuille')).toHaveCount(1);
});

test('la feuille d’un nouvel élément s’ouvre depuis le haut', async ({ page }) => {
  const id = await creerChantier(
    page,
    'Défilement e2e',
    `projet.niveaux[0].actuel.pieces.push(fabrique.pieceRectangle('Salon', 500, 400));`,
  );
  await page.goto(`./#/chantier/${id}`);
  await toucher(page, { x: 250, y: -4 });
  await expect(page.getByRole('heading', { name: 'Côté 1 · Salon' })).toBeVisible();
  const corps = page.locator(tactile() ? '.feuille-corps' : '.plan2d-panneau-corps');
  await corps.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('button', { name: 'Ajouter une porte' }).click();
  await expect(page.getByRole('heading', { name: 'Porte · Salon' })).toBeVisible();
  await expect.poll(() => corps.evaluate((el) => el.scrollTop)).toBe(0);
});

test('clavier ouvert : la pièce en cours de modification reste visible au-dessus de la feuille', async ({ page }) => {
  test.skip(!tactile(), 'clavier virtuel : téléphone seulement');
  const id = await creerChantier(
    page,
    'Clavier e2e',
    `projet.niveaux[0].actuel.pieces.push(
      fabrique.pieceRectangle('Salon', 500, 400),
      fabrique.pieceRectangle('Chambre', 350, 300, { origine: { x: 0, y: 500 } }),
    );`,
  );
  await page.goto(`./#/chantier/${id}`);
  await toucher(page, { x: 175, y: 600 });
  await expect(page.getByRole('heading', { name: 'Chambre', exact: true })).toBeVisible();
  await page.locator('.plan2d-proprietes').getByLabel('Nom', { exact: true }).click();
  // Le clavier réduit la fenêtre (interactive-widget=resizes-content).
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.width, height: vp.height - 340 });
  const etiquette = page.locator('[data-etiquette]').filter({ hasText: 'Chambre' });
  await expect
    .poll(async () => {
      const e = await etiquette.boundingBox();
      const f = await page.locator('.feuille').boundingBox();
      const svg = await page.locator('svg.plan2d-svg').boundingBox();
      return !!e && !!f && !!svg && e.y >= svg.y && e.y + e.height <= f.y;
    })
    .toBe(true);
});

test('textes du plan lisibles : cote active, étiquette d’une petite pièce, cote d’un mur avec porte', async ({ page }) => {
  const id = await creerChantier(
    page,
    'Textes e2e',
    `const salon = fabrique.pieceRectangle('Salon', 500, 400);
    salon.ouvertures.push(fabrique.nouvelleOuverture('porte', 0, 208.5));
    const sdb = fabrique.pieceRectangle('Salle de bain', 300, 180, { origine: { x: 600, y: 300 } });
    sdb.equipements.push(fabrique.nouvelEquipement('baignoire', { x: 720, y: 335 }));
    projet.niveaux[0].actuel.pieces.push(
      salon,
      fabrique.pieceRectangle('Cuisine', 350, 280, { origine: { x: 600, y: 0 } }),
      sdb,
    );`,
  );
  await page.goto(`./#/chantier/${id}`);
  await expect(page.locator('[data-etiquette]').filter({ hasText: 'Salon' })).toHaveCount(1);
  // Même échelle sur PC et téléphone (celle d'un téléphone après le relevé).
  while ((await lireVue(page)).echelle > 0.24) await page.getByRole('button', { name: 'Zoom arrière' }).click();
  type Boite = { x: number; y: number; width: number; height: number };
  const seCoupent = (a: Boite, b: Boite) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  // Étiquette de la salle de bain : dans la pièce, sans mordre sur les murs.
  const idSdb = await page.evaluate(() => (window as any).__etat.getState().projet.niveaux[0].actuel.pieces[2].id as string);
  const coin0 = await versEcran(page, { x: 600, y: 300 });
  const coin1 = await versEcran(page, { x: 900, y: 480 });
  const bs = (await page.locator(`[data-etiquette="${idSdb}"]`).boundingBox())!;
  expect(bs.x).toBeGreaterThanOrEqual(coin0.x);
  expect(bs.x + bs.width).toBeLessThanOrEqual(coin1.x);

  // Aucune cote sous l'arc de la porte du salon.
  const arc = (await page.locator('.plan2d-ouverture-arc').first().boundingBox())!;
  for (const c of await page.locator('.plan2d-cote').all()) {
    expect(seCoupent((await c.boundingBox())!, arc)).toBe(false);
  }

  // Côté gauche de la cuisine sélectionné : sa cote ne recouvre aucune étiquette.
  await toucher(page, { x: 596, y: 140 });
  await expect(page.getByRole('heading', { name: 'Côté 4 · Cuisine' })).toBeVisible();
  const active = (await page.locator('.plan2d-cote.active').boundingBox())!;
  for (const e of await page.locator('[data-etiquette]').all()) {
    expect(seCoupent(active, (await e.boundingBox())!)).toBe(false);
  }
});
