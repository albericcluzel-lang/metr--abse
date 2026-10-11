import { expect, test } from '@playwright/test';

test('l’appli démarre', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByText('Chargement…')).toHaveCount(0);
});
