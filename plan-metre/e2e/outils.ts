// Aides pour les tests de bout en bout (serveur de développement uniquement).
import type { Page } from '@playwright/test';

/**
 * Crée un chantier via l'état de l'appli, l'ouvre et renvoie son identifiant.
 * `preparer` reçoit (projet, fabrique) et peut modifier le projet avant enregistrement.
 */
export async function creerChantier(
  page: Page,
  nom: string,
  preparer?: string,
): Promise<string> {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__etat?.getState().pret);
  return page.evaluate(
    async ({ nom, preparer }) => {
      const w = window as any;
      const etat = w.__etat.getState();
      const projet = await etat.creerProjet({ nom });
      if (preparer) {
        const fn = new Function('projet', 'fabrique', preparer);
        fn(projet, w.__fabrique);
        await etat.importerProjet(projet);
      }
      return projet.id as string;
    },
    { nom, preparer },
  );
}
