import { expect, test } from '@playwright/test';
import { creerChantier } from './outils';

// Bouton « retour » d'Android (simulé par page.goBack()).

test('le retour ferme la feuille ouverte au lieu de quitter l’écran', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Nouveau chantier' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Mes chantiers' })).toBeVisible();
});

test('le retour désélectionne la pièce sans fermer le chantier', async ({ page }, info) => {
  test.skip(info.project.name !== 'android', 'feuille de propriétés : téléphone');
  const id = await creerChantier(page, 'Retour', "projet.niveaux[0].actuel.pieces.push(fabrique.pieceRectangle('Séjour', 500, 400));");
  await page.goto('./');
  await page.getByText('Retour', { exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));
  await page.evaluate(() => {
    const e = (window as any).__etat.getState();
    e.selectionner({ type: 'piece', pieceId: e.projet.niveaux[0].actuel.pieces[0].id });
  });
  await expect(page.locator('.plan2d-proprietes')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.plan2d-proprietes')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));
  expect(await page.evaluate(() => (window as any).__etat.getState().selection)).toBeNull();
});

test('les flèches « Retour au plan » ne font pas tourner le retour système en rond', async ({ page }) => {
  const id = await creerChantier(page, 'Historique');
  await page.goto('./');
  await page.getByText('Historique', { exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));
  await page.getByRole('button', { name: /Métré/ }).last().click();
  await expect(page).toHaveURL(/\/metre$/);
  await page.getByRole('button', { name: 'Retour au plan' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));
  await page.getByRole('button', { name: /^Photos/ }).click();
  await expect(page).toHaveURL(/\/photos$/);
  await page.getByRole('button', { name: 'Retour au plan' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));
  // Un seul retour système ramène à l'accueil.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Mes chantiers' })).toBeVisible();
});
