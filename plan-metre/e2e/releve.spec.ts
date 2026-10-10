import { expect, test, type Page } from '@playwright/test';
import { creerChantier } from './outils';

interface PieceLue {
  nom: string;
  hauteur: number;
  sommets: { x: number; y: number }[];
}

function aire(points: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}

function boite(points: { x: number; y: number }[]) {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/** Pièces du plan actuel du RDC, lues dans l'état de l'appli. */
async function piecesRdc(page: Page): Promise<{ pieces: PieceLue[]; variante: string; niveauCourant: boolean; renove: unknown }> {
  return page.evaluate(() => {
    const etat = (window as any).__etat.getState();
    const rdc = etat.projet.niveaux.find((n: any) => n.nom === 'RDC');
    return {
      pieces: rdc.actuel.pieces.map((p: any) => ({ nom: p.nom, hauteur: p.hauteur, sommets: p.sommets })),
      variante: etat.variante,
      niveauCourant: etat.niveauId === rdc.id,
      renove: rdc.renove,
    };
  });
}

test('mètre laser et pièce rectangulaire ajoutés au plan en une étape', async ({ page }) => {
  const id = await creerChantier(page, 'Relevé de pièces');
  await page.goto(`./#/chantier/${id}`);
  await page.getByRole('button', { name: 'Ajouter une pièce' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}/releve$`));

  // Pas de réalité augmentée dans le Chromium de test : carte grisée qui explique pourquoi.
  const carteRA = page.getByRole('button', { name: 'Réalité augmentée' });
  await expect(carteRA).toBeDisabled();
  await expect(carteRA).toContainText('Services Google Play pour la RA');
  await expect(carteRA).toContainText('https');

  // Mètre laser : 400 / 300 / 400 / 300 en tournant à droite.
  await page.getByRole('button', { name: 'Mètre laser' }).click();
  await expect(page.getByText('Faites le tour de la pièce dans le sens des aiguilles d’une montre', { exact: false })).toBeVisible();
  for (const [i, longueur] of [400, 300, 400].entries()) {
    const champ = page.getByLabel(`Côté ${i + 1}`, { exact: true });
    await expect(champ).toBeFocused();
    await champ.fill(String(longueur));
    await page.getByRole('button', { name: 'Tourner à droite' }).click();
  }
  // Trois côtés saisis : le segment de fermeture (pointillés) mesure 300 cm.
  await expect(page.getByText('Segment de fermeture (pointillés) : 300 cm.')).toBeVisible();
  await page.getByLabel('Côté 4', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Fermer la pièce' }).click();

  const zones = page.getByRole('list', { name: 'Zones relevées' }).getByRole('listitem');
  await expect(zones).toHaveCount(1);
  await expect(zones.first()).toContainText('12,00 m²');
  await expect(zones.first()).toContainText('Mètre laser');

  // Pièce rectangulaire 250 × 200.
  await page.getByRole('button', { name: 'Ajouter une zone à la capture' }).click();
  await page.getByRole('button', { name: 'Pièce rectangulaire' }).click();
  await page.getByLabel('Nom de la pièce').fill('Cuisine');
  await page.getByLabel('Longueur', { exact: true }).fill('250');
  await page.getByLabel('Largeur', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Ajouter la zone' }).click();
  await expect(zones).toHaveCount(2);
  await expect(zones.nth(1)).toContainText('Cuisine');
  await expect(zones.nth(1)).toContainText('5,00 m²');

  // Finalisation vers le RDC, plan actuel.
  await page.getByRole('button', { name: 'Finaliser la capture' }).click();
  await expect(page.getByLabel('Nom de la zone 1')).toHaveValue('Pièce 1');
  await expect(page.getByLabel('Nom de la zone 2')).toHaveValue('Cuisine');
  await page.getByLabel('Nom de la zone 1').fill('Séjour');
  await page.getByLabel('Niveau', { exact: true }).selectOption({ label: 'RDC' });
  await page.getByRole('button', { name: 'Plan actuel' }).click();
  await expect(page.getByRole('switch', { name: /Redresser les angles/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Sauvegarder et continuer' }).click();

  // Retour sur le plan, avec les deux pièces.
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));
  await expect(page.getByText('2 pièces ajoutées')).toBeVisible();
  const { pieces, variante, niveauCourant, renove } = await piecesRdc(page);
  expect(variante).toBe('actuel');
  expect(niveauCourant).toBe(true);
  expect(renove).toBeNull();
  expect(pieces.map((p) => p.nom)).toEqual(['Séjour', 'Cuisine']);
  expect(pieces.map((p) => aire(p.sommets) / 10000)).toEqual([12, 5]);
  expect(pieces.every((p) => p.hauteur === 250)).toBe(true);
  const [a, b] = pieces.map((p) => boite(p.sommets));
  const chevauchement = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
  expect(chevauchement).toBe(false);

  // Une seule étape d'annulation pour tout l'ajout.
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect((await piecesRdc(page)).pieces).toHaveLength(0);
});

test('le relevé en cours survit à un rechargement ; une zone peut être retirée', async ({ page }) => {
  const id = await creerChantier(page, 'Brouillon');
  await page.goto(`./#/chantier/${id}/releve`);
  await page.getByRole('button', { name: 'Pièce rectangulaire' }).click();
  await page.getByLabel('Longueur', { exact: true }).fill('300');
  await page.getByLabel('Largeur', { exact: true }).fill('280');
  await page.getByRole('button', { name: 'Ajouter la zone' }).click();
  const zones = page.getByRole('list', { name: 'Zones relevées' }).getByRole('listitem');
  await expect(zones).toHaveCount(1);

  await page.reload();
  await expect(page.getByText('Relevé en cours retrouvé : 1 zone')).toBeVisible();
  await expect(zones).toHaveCount(1);
  await expect(zones.first()).toContainText('8,40 m²');

  await page.getByRole('button', { name: 'Retirer Zone 1' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Retirer' }).click();
  await expect(page.getByText('Comment voulez-vous relever la pièce ?')).toBeVisible();
});

test('mètre laser : écart de fermeture important signalé, angle libre', async ({ page }) => {
  const id = await creerChantier(page, 'Écart');
  await page.goto(`./#/chantier/${id}/releve`);
  await page.getByRole('button', { name: 'Mètre laser' }).click();
  for (const [i, longueur] of [400, 300, 412].entries()) {
    await page.getByLabel(`Côté ${i + 1}`, { exact: true }).fill(String(longueur));
    await page.getByRole('button', { name: 'Tourner à droite' }).click();
  }
  await page.getByLabel('Côté 4', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Fermer la pièce' }).click();
  const dialogue = page.getByRole('alertdialog');
  await expect(dialogue).toContainText('Écart de fermeture important');
  await expect(dialogue).toContainText('12 cm');
  await dialogue.getByRole('button', { name: 'Vérifier' }).click();

  // Correction : on annule le 4e côté puis le 3e, et on ressaisit.
  await page.getByRole('button', { name: 'Annuler le dernier côté' }).click();
  await expect(page.getByLabel('Côté 3', { exact: true })).toHaveValue('412');
  await page.getByLabel('Côté 3', { exact: true }).fill('400');
  // Virage par un angle intérieur de 90° (équivaut à tourner à droite).
  await page.getByRole('button', { name: 'Autre angle…' }).click();
  await page.getByLabel('Angle intérieur, mesuré dans la pièce').fill('90');
  await page.getByRole('button', { name: 'Valider le virage' }).click();
  await page.getByLabel('Côté 4', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Fermer la pièce' }).click();
  await expect(page.getByRole('list', { name: 'Zones relevées' }).getByRole('listitem').first()).toContainText('12,00 m²');
});

/**
 * Remplace la session WebXR par une session simulée (le module est partagé
 * par le serveur de développement) : `window.__ra.viser(p)` fixe le point visé.
 */
async function simulerSessionRA(page: Page) {
  await page.evaluate(async () => {
    const url = '/metr--abse/src/ui/capture/sessionRA.ts';
    const module = await import(/* @vite-ignore */ url);
    const w = window as any;
    module.SessionRA.demarrer = async (_racine: HTMLElement, rappels: any) => {
      const session = {
        avecSurimpression: true,
        visee: null as unknown,
        dessiner() {},
        async terminer() {
          rappels.surFin(false);
        },
      };
      w.__ra = {
        viser(p: unknown) {
          session.visee = p;
          rappels.surVisee({ point: p, suivi: true, estime: false });
        },
      };
      return session;
    };
  });
}

test('réalité augmentée (session simulée) : deux pièces dans le même repère', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: { isSessionSupported: async () => true, requestSession: async () => Promise.reject(new Error('non simulé')) },
    });
  });
  const id = await creerChantier(page, 'RA simulée');
  await page.goto(`./#/chantier/${id}/releve`);
  await simulerSessionRA(page);
  const viser = (x: number, z: number, y = -1.4) => page.evaluate((p) => (window as any).__ra.viser(p), { x, y, z });

  await page.getByRole('button', { name: 'Réalité augmentée' }).click();
  await page.getByRole('button', { name: 'Démarrer la réalité augmentée' }).click();
  const placer = page.getByRole('button', { name: 'Placer un angle' });
  await expect(placer).toBeVisible();
  await expect(page.getByText('Balayez lentement le sol', { exact: false })).toBeVisible();

  // Aucune surface visée : avertissement, pas d'angle.
  await placer.click();
  await expect(page.getByRole('alert')).toContainText('Aucune surface visée');

  // Première pièce, environ 4 m × 3 m (relevé légèrement imprécis).
  for (const [x, z] of [
    [0, 0],
    [4.02, 0.03],
    [4, 3],
    [0.01, 2.98],
  ]) {
    await viser(x, z);
    await placer.click();
  }
  await viser(1, 2);
  await expect(page.getByText(/^4 angles · 11,9\d m²$/)).toBeVisible();
  await expect(page.getByText('depuis le dernier angle')).toBeVisible();
  const fermer = page.getByRole('button', { name: 'Fermer la pièce' });
  await expect(fermer).not.toHaveClass(/proche/);
  await viser(0.06, 0.05);
  await expect(fermer).toHaveClass(/proche/);
  await fermer.click();

  // Hauteur : mesure visée (2,55 m au-dessus du sol), puis zone terminée.
  await expect(page.getByText('Visez la jonction mur / plafond puis touchez Mesurer la hauteur.')).toBeVisible();
  await viser(2, 0, -1.4 + 2.55);
  await page.getByRole('button', { name: 'Mesurer la hauteur' }).click();
  await expect(page.getByText('Hauteur retenue : 255 cm (mesurée)')).toBeVisible();
  await page.getByRole('button', { name: 'Terminer la zone' }).click();
  await expect(page.getByText('Zone 1 terminée')).toBeVisible();

  // Deuxième pièce dans la même session, à côté (cloison de 10 cm), interrompue par « Quitter ».
  await page.getByRole('button', { name: 'Relever une autre pièce' }).click();
  for (const [x, z] of [
    [4.1, 0],
    [7, 0],
    [7, 3],
    [4.1, 3],
  ]) {
    await viser(x, z);
    await placer.click();
  }
  await page.getByRole('button', { name: 'Quitter' }).click();

  const zones = page.getByRole('list', { name: 'Zones relevées' }).getByRole('listitem');
  await expect(zones).toHaveCount(2);
  await expect(zones.nth(0)).toContainText('Réalité augmentée · hauteur 255 cm');
  await expect(zones.nth(1)).toContainText('8,70 m²');
  await expect(page.getByText(/hauteur par défaut 250 cm, à vérifier/)).toBeVisible();

  await page.getByRole('button', { name: 'Finaliser la capture' }).click();
  await expect(page.getByRole('switch', { name: /Redresser les angles/ })).toBeChecked();
  await page.getByRole('button', { name: 'Sauvegarder et continuer' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));

  const { pieces } = await piecesRdc(page);
  expect(pieces).toHaveLength(2);
  expect(pieces.map((p) => p.hauteur)).toEqual([255, 250]);
  // Redressées : 4 sommets, côtés horizontaux ou verticaux.
  for (const p of pieces) {
    expect(p.sommets).toHaveLength(4);
    p.sommets.forEach((s, i) => {
      const t = p.sommets[(i + 1) % 4];
      expect(Math.min(Math.abs(s.x - t.x), Math.abs(s.y - t.y))).toBeLessThan(0.5);
    });
  }
  expect(Math.abs(aire(pieces[0].sommets) / 10000 - 12)).toBeLessThan(0.15);
  expect(Math.abs(aire(pieces[1].sommets) / 10000 - 8.7)).toBeLessThan(0.15);
  // Positions relatives gardées : la deuxième pièce est à ~10 cm à droite de la première.
  const [a, b] = pieces.map((p) => boite(p.sommets));
  expect(b.minX - a.maxX).toBeGreaterThan(2);
  expect(b.minX - a.maxX).toBeLessThan(20);
  expect(Math.abs(b.minY - a.minY)).toBeLessThan(5);
});

test('réalité augmentée : refus de la caméra expliqué en français', async ({ page }) => {
  // Simule un téléphone compatible dont l'utilisateur refuse l'accès à la caméra.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: {
        isSessionSupported: async (mode: string) => mode === 'immersive-ar',
        requestSession: async () => {
          throw new DOMException('Permission refusée', 'NotAllowedError');
        },
      },
    });
  });
  const id = await creerChantier(page, 'Réalité augmentée');
  await page.goto(`./#/chantier/${id}/releve`);
  const carteRA = page.getByRole('button', { name: 'Réalité augmentée' });
  await expect(carteRA).toBeEnabled();
  await carteRA.click();
  await expect(page.getByText('Visez le sol au pied d’un mur, dans un angle', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Démarrer la réalité augmentée' }).click();
  await expect(page.getByRole('alert')).toContainText('Accès à la caméra refusé');
  // On peut revenir et choisir une autre méthode.
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.getByRole('button', { name: 'Mètre laser' })).toBeVisible();
});
