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
  // Toucher le vide (en haut, au milieu de l'écran) désélectionne et referme le panneau.
  const boite = (await page.locator('svg.plan2d-svg').boundingBox())!;
  if (tactile()) await page.touchscreen.tap(boite.x + boite.width / 2, boite.y + 40);
  else await page.mouse.click(boite.x + boite.width / 2, boite.y + 40);
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
