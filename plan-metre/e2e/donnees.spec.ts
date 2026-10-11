import { expect, test } from '@playwright/test';
import { creerChantier } from './outils';

test('une modification suivie d’un rechargement immédiat n’est pas perdue', async ({ page }) => {
  const id = await creerChantier(
    page,
    'Rechargement',
    "projet.niveaux[0].actuel.pieces.push(fabrique.pieceRectangle('Séjour', 500, 400));",
  );
  await page.goto(`./#/chantier/${id}`);
  await page.waitForFunction((id) => (window as any).__etat.getState().projet?.id === id, id);
  // Modification puis rechargement sans laisser à l'écriture différée le temps de partir.
  await page.evaluate(() => {
    (window as any).__etat.getState().modifierPlan((plan: any) => {
      plan.pieces[0].nom = 'Séjour-cuisine';
    });
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__etat?.getState().pret);
  const nom = await page.evaluate(
    (id) => (window as any).__etat.getState().projets.find((p: any) => p.id === id).niveaux[0].actuel.pieces[0].nom,
    id,
  );
  expect(nom).toBe('Séjour-cuisine');
});
