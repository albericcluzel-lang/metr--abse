import { expect, test, type Page } from '@playwright/test';
import { creerChantier } from './outils';

// Petit appartement : salle de bain (porte, fenêtre, baignoire, vasque, WC),
// chambre, dégagement et séjour avec baie vitrée et coin cuisine.
const AMORCE = `
  const n = projet.niveaux[0];
  const e = 9.8;
  const sdb = fabrique.pieceRectangle('Salle de bain', 204, 175, { hauteur: 250 });
  sdb.revetementSolId = 'carrelage';
  sdb.ouvertures.push(fabrique.nouvelleOuverture('porte', 2, 60));
  sdb.ouvertures.push(fabrique.nouvelleOuverture('fenetre', 0, 60, { largeur: 80 }));
  const baignoire = fabrique.nouvelEquipement('baignoire', { x: 93.5, y: 31 });
  baignoire.largeur = 187;
  baignoire.profondeur = 52;
  const vasque = fabrique.nouvelEquipement('meuble-vasque', { x: 181, y: 120 });
  vasque.rotation = 90;
  const wc = fabrique.nouvelEquipement('wc', { x: 33.5, y: 135 });
  wc.rotation = 270;
  sdb.equipements.push(baignoire, vasque, wc);

  const chambre = fabrique.pieceRectangle('Chambre', 350, 300, { hauteur: 250, origine: { x: 204 + e, y: 0 } });
  chambre.revetementSolId = 'parquet';
  chambre.ouvertures.push(fabrique.nouvelleOuverture('fenetre', 0, 110, { largeur: 120 }));
  chambre.ouvertures.push(fabrique.nouvelleOuverture('porte', 3, 15));
  const placard = fabrique.nouvelEquipement('placard', { x: 204 + e + 300, y: 200 });
  placard.rotation = 90;
  chambre.equipements.push(placard);

  const degagement = fabrique.pieceRectangle('Dégagement', 204, 300 - 175 - e, { hauteur: 250, origine: { x: 0, y: 175 + e } });
  degagement.revetementSolId = 'carrelage';

  const sejour = fabrique.pieceRectangle('Séjour', 554 + e, 380, { hauteur: 250, origine: { x: 0, y: 300 + e } });
  sejour.revetementSolId = 'stratifie';
  sejour.ouvertures.push(fabrique.nouvelleOuverture('passage', 0, 60, { largeur: 90 }));
  sejour.ouvertures.push(fabrique.nouvelleOuverture('baie', 2, 150));
  sejour.ouvertures.push(fabrique.nouvelleOuverture('fenetre', 1, 140));
  const evier = fabrique.nouvelEquipement('evier', { x: 30, y: 300 + e + 190 });
  evier.rotation = 270;
  const meuble = fabrique.nouvelEquipement('meuble-cuisine', { x: 30, y: 300 + e + 100 });
  meuble.rotation = 270;
  sejour.equipements.push(evier, meuble);

  n.actuel.pieces.push(sdb, chambre, degagement, sejour);
`;

const DOSSIER_CAPTURES = process.env.CAPTURES_VUE3D;

/** Erreurs de la page (console et exceptions), vérifiées en fin de test. */
function surveillerErreurs(page: Page): string[] {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(`exception : ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') erreurs.push(`console : ${m.text()}`);
  });
  return erreurs;
}

async function compteur(page: Page, nom: 'rendus' | 'geometries'): Promise<number> {
  return Number((await page.locator('.vue3d-zone').getAttribute(`data-${nom}`)) ?? 0);
}

/** Attend que plus aucune image ne soit dessinée (fin de l'inertie, du recentrage…). */
async function attendreImmobile(page: Page): Promise<number> {
  let avant = -1;
  for (let i = 0; i < 40; i++) {
    const n = await compteur(page, 'rendus');
    if (n === avant && n > 0) return n;
    avant = n;
    await page.waitForTimeout(250);
  }
  throw new Error('la vue 3D ne s’arrête pas de dessiner');
}

async function ouvrirEn3D(page: Page, preparer?: string, etatAttendu = 'pret') {
  const id = await creerChantier(page, 'Appartement test 3D', preparer);
  await page.goto(`./#/chantier/${id}`);
  await page.getByRole('button', { name: 'Vue 3D' }).click();
  await expect(page.locator('.vue3d')).toHaveAttribute('data-etat', etatAttendu);
}

test('affiche le chantier en 3D, se manipule, se recentre et revient en 2D', async ({ page }, info) => {
  const erreurs = surveillerErreurs(page);
  await ouvrirEn3D(page, AMORCE);

  const canevas = page.locator('.vue3d canvas');
  await expect(canevas).toBeVisible();
  const boite = (await canevas.boundingBox())!;
  const zone = (await page.locator('.chantier-zone').boundingBox())!;
  expect(Math.round(boite.width)).toBe(Math.round(zone.width));
  expect(Math.round(boite.height)).toBe(Math.round(zone.height));
  // Densité de pixels plafonnée à 2.
  const densite = await canevas.evaluate((c: HTMLCanvasElement) => c.width / c.clientWidth);
  expect(densite).toBeLessThanOrEqual(2.01);

  // Étiquettes des pièces en surimpression (une étiquette qui en chevaucherait
  // une autre est masquée : le petit dégagement peut l'être en vue d'ensemble).
  await expect(page.locator('.vue3d-etiquette')).toHaveCount(4);
  for (const nom of ['Salle de bain', 'Chambre', 'Séjour']) {
    await expect(page.locator('.vue3d-etiquette', { hasText: nom })).toBeVisible();
  }
  await expect(page.locator('.vue3d-etiquette', { hasText: 'Salle de bain' })).toContainText('3,57');
  const rectangles = await page
    .locator('.vue3d-etiquette')
    .evaluateAll((els) =>
      els.filter((e) => getComputedStyle(e).visibility !== 'hidden').map((e) => e.getBoundingClientRect().toJSON()),
    );
  for (let i = 0; i < rectangles.length; i++) {
    for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i];
      const b = rectangles[j];
      const chevauche = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(chevauche, 'deux étiquettes visibles se chevauchent').toBe(false);
    }
  }
  await expect(page.locator('.vue3d-aide')).toBeVisible();

  // Rendu à la demande : rien n'est redessiné quand rien ne bouge.
  const immobile = await attendreImmobile(page);
  await page.waitForTimeout(600);
  expect(await compteur(page, 'rendus')).toBe(immobile);

  if (DOSSIER_CAPTURES) {
    await page.screenshot({ path: `${DOSSIER_CAPTURES}/vue3d-${info.project.name === 'pc' ? 'pc' : 'telephone'}.png` });
  }

  // Rotation à la souris (glisser) : la vue est redessinée, l'aide disparaît.
  const cx = boite.x + boite.width / 2;
  const cy = boite.y + boite.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.vue3d-aide')).toHaveCount(0);
  const apresRotation = await attendreImmobile(page);
  expect(apresRotation).toBeGreaterThan(immobile);

  // Molette : zoom.
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -300);
  const apresZoom = await attendreImmobile(page);
  expect(apresZoom).toBeGreaterThan(apresRotation);

  if (DOSSIER_CAPTURES && info.project.name !== 'pc') {
    await page.screenshot({ path: `${DOSSIER_CAPTURES}/vue3d-telephone-tournee.png` });
  }

  // Recentrer (sous le bouton 2D / 3D).
  const recentrer = page.getByRole('button', { name: 'Recentrer la vue' });
  await expect(recentrer).toBeEnabled();
  const bRecentrer = (await recentrer.boundingBox())!;
  const bBascule = (await page.getByRole('button', { name: 'Plan 2D' }).boundingBox())!;
  expect(bRecentrer.y).toBeGreaterThanOrEqual(bBascule.y + bBascule.height);
  expect(Math.round(bRecentrer.x + bRecentrer.width)).toBe(Math.round(bBascule.x + bBascule.width));
  expect(bRecentrer.width).toBeGreaterThanOrEqual(44);
  await recentrer.click();
  expect(await attendreImmobile(page)).toBeGreaterThan(apresZoom);

  // Retour en 2D : la vue 3D et son canevas disparaissent.
  await page.getByRole('button', { name: 'Plan 2D' }).click();
  await expect(page.locator('.vue3d')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vue 3D' })).toBeVisible();

  expect(erreurs).toEqual([]);
});

test('reconstruit la maquette quand le plan change, sans fuite mémoire', async ({ page }) => {
  const erreurs = surveillerErreurs(page);
  await ouvrirEn3D(page, AMORCE);
  await attendreImmobile(page);
  const geometries = await compteur(page, 'geometries');
  expect(geometries).toBeGreaterThan(10);

  // Plusieurs modifications successives (renommage) : même nombre de géométries en mémoire.
  for (let i = 0; i < 4; i++) {
    await page.evaluate((i) => {
      (window as any).__etat.getState().modifierPlan((p: any) => {
        p.pieces[1].nom = `Chambre ${i + 2}`;
      });
    }, i);
    await expect(page.locator('.vue3d-etiquette', { hasText: `Chambre ${i + 2}` })).toBeVisible();
  }
  await attendreImmobile(page);
  expect(await compteur(page, 'geometries')).toBe(geometries);

  // Suppression d'une pièce puis annulation.
  await page.evaluate(() => (window as any).__etat.getState().modifierPlan((p: any) => p.pieces.splice(3, 1)));
  await expect(page.locator('.vue3d-etiquette')).toHaveCount(3);
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('.vue3d-etiquette')).toHaveCount(4);

  // Plan rénové (copie du plan actuel) affiché en 3D.
  await page.getByRole('button', { name: 'Plan rénové' }).click();
  await expect(page.locator('.vue3d-etiquette')).toHaveCount(4);
  await expect(page.locator('.vue3d')).toHaveAttribute('data-etat', 'pret');

  expect(erreurs).toEqual([]);
});

test('niveau sans pièce : message clair et Recentrer désactivé', async ({ page }) => {
  const erreurs = surveillerErreurs(page);
  await ouvrirEn3D(page);
  await expect(page.getByText('Aucune pièce sur ce niveau')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recentrer la vue' })).toBeDisabled();
  await expect(page.locator('.vue3d canvas')).toBeVisible();
  expect(erreurs).toEqual([]);
});

test('WebGL indisponible : message explicite', async ({ page }) => {
  await page.addInitScript(() => {
    const origine = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...reste: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return (origine as any).call(this, type, ...reste);
    } as typeof origine;
  });
  const erreurs = surveillerErreurs(page);
  await ouvrirEn3D(page, AMORCE, 'indisponible');
  await expect(page.getByText('Vue 3D indisponible')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recentrer la vue' })).toBeDisabled();
  expect(erreurs).toEqual([]);
});
