import { expect, test, type Page } from '@playwright/test';
import { creerChantier } from './outils';

// Réglages du chantier : informations, niveaux, catalogue, métré, export et
// suppression du chantier.
//
// CAPTURES_REGLAGES=<dossier> enregistre aussi des captures d'écran.

const DOSSIER_CAPTURES = process.env.CAPTURES_REGLAGES;

const CHANTIER = `
  const rdc = projet.niveaux[0];
  const sejour = fabrique.pieceRectangle('Séjour', 500, 400, { typeMurDefautId: 'cloison-72' });
  sejour.revetementSolId = 'parquet';
  const cuisine = fabrique.pieceRectangle('Cuisine', 300, 400, { origine: { x: 500, y: 0 } });
  cuisine.sommets[1].typeMurId = 'cloison-72';
  rdc.actuel.pieces.push(sejour, cuisine);
  rdc.renove = { pieces: [structuredClone(sejour)] };
  projet.client = 'M. Dupont';
  projet.adresse = '12 rue des Lilas, Montpellier';
`;

/** Lit l'état de l'appli dans la page. */
function lire<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate((code) => new Function('etat', `return (${code})`)((window as any).__etat.getState()), fn);
}

async function ouvrirReglages(page: Page, nom = 'Villa Dupont'): Promise<string> {
  const id = await creerChantier(page, nom, CHANTIER);
  await page.goto(`./#/chantier/${id}/parametres`);
  await expect(page.getByRole('heading', { name: /Réglages du chantier/ })).toBeVisible();
  return id;
}

async function confirmer(page: Page, texte: RegExp | string, bouton = 'Supprimer') {
  const dialogue = page.getByRole('alertdialog');
  await expect(dialogue).toContainText(texte);
  await dialogue.getByRole('button', { name: bouton, exact: true }).click();
  await expect(dialogue).toHaveCount(0);
}

async function capturer(page: Page, nom: string, projet: 'android' | 'pc') {
  if (!DOSSIER_CAPTURES || test.info().project.name !== projet) return;
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6_000 });
  await page.screenshot({ path: `${DOSSIER_CAPTURES}/reglages-${nom}.png` });
}

test('renomme le chantier en une seule étape d’annulation et garde le nom obligatoire', async ({ page }) => {
  const id = await ouvrirReglages(page);
  await capturer(page, 'informations', 'android');
  const nom = page.getByLabel('Nom du chantier');
  await expect(nom).toHaveValue('Villa Dupont');

  await nom.clear();
  await expect(page.getByText('Le chantier doit garder un nom.')).toBeVisible();
  await nom.pressSequentially('Villa Martin');
  await expect.poll(() => lire(page, 'etat.projet.nom')).toBe('Villa Martin');
  // Toute la frappe du champ forme une seule étape d'annulation.
  expect(await lire(page, 'etat.passe.length')).toBe(1);
  await expect(page.getByText('Le chantier doit garder un nom.')).toHaveCount(0);

  await page.getByLabel('Client').fill('SCI Martin');
  await page.getByLabel('Notes').fill('Code portail 1234');
  expect(await lire(page, 'etat.passe.length')).toBe(3);

  // Un nom vidé puis abandonné revient au dernier nom valable.
  await nom.fill('');
  await page.getByLabel('Client').focus();
  await expect(nom).toHaveValue('Villa Martin');
  expect(await lire(page, 'etat.projet.nom')).toBe('Villa Martin');

  await expect(page.locator('.barre-haut-sous-titre')).toHaveText('Villa Martin');
  await expect.poll(() => lire(page, 'etat.enregistrement')).toBe('enregistre');
  await page.reload();
  await expect(page.getByLabel('Nom du chantier')).toHaveValue('Villa Martin');
  await expect(page.getByLabel('Client')).toHaveValue('SCI Martin');
  await expect(page.getByLabel('Notes')).toHaveValue('Code portail 1234');

  // Retour au plan, puis à l'accueil : le nouveau nom y figure.
  await page.getByRole('button', { name: 'Retour au plan' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));
  await page.goto('./#/');
  await expect(page.locator('.accueil-carte-nom')).toHaveText(['Villa Martin']);
});

test('ajoute, range et supprime des niveaux', async ({ page }) => {
  await ouvrirReglages(page);
  // Une photo rattachée au RDC (image quelconque : elle n'est pas affichée ici).
  await page.evaluate(async () => {
    const etat = (window as any).__etat.getState();
    const rdc = etat.projet.niveaux[0];
    await etat.ajouterPhoto(
      {
        id: 'photo-rdc',
        projetId: etat.projet.id,
        niveauId: rdc.id,
        pieceId: rdc.actuel.pieces[0].id,
        position: { x: 100, y: 100 },
        legende: 'Séjour',
        date: new Date().toISOString(),
        largeur: 10,
        hauteur: 10,
      },
      { complete: new Blob(['a'], { type: 'image/jpeg' }), vignette: new Blob(['b'], { type: 'image/jpeg' }) },
    );
  });
  const noms = page.getByLabel('Nom du niveau');
  await expect(noms).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Supprimer le niveau « RDC »' })).toBeDisabled();
  await expect(page.getByText('Un chantier garde toujours au moins un niveau.')).toBeVisible();

  // Ajout : « R+1 » proposé, placé au-dessus ; « Sous-sol » en dessous.
  await page.getByRole('button', { name: 'Ajouter un niveau' }).click();
  const feuille = page.getByRole('dialog', { name: 'Nouveau niveau' });
  await expect(feuille.getByLabel('Nom du niveau')).toHaveValue('R+1');
  await feuille.getByRole('button', { name: 'Ajouter' }).click();
  await page.getByRole('button', { name: 'Ajouter un niveau' }).click();
  await feuille.getByLabel('Nom du niveau').fill('Sous-sol');
  await feuille.getByLabel('Hauteur sous plafond par défaut').fill('220');
  await feuille.getByLabel('Nom du niveau').press('Enter');
  await expect(feuille).toHaveCount(0);
  await expect(noms).toHaveCount(3);
  await expect(noms.nth(0)).toHaveValue('R+1');
  await expect(noms.nth(1)).toHaveValue('RDC');
  await expect(noms.nth(2)).toHaveValue('Sous-sol');
  expect(await lire(page, `etat.projet.niveaux.find((n) => n.nom === 'Sous-sol').hauteurDefaut`)).toBe(220);

  // Ordre : le R+1 descend sous le RDC (ordre des niveaux du plan).
  await expect(page.getByRole('button', { name: 'Monter « R+1 »' })).toBeDisabled();
  await page.getByRole('button', { name: 'Descendre « R+1 »' }).click();
  await expect(noms.nth(0)).toHaveValue('RDC');
  await expect(noms.nth(1)).toHaveValue('R+1');
  expect(await lire(page, `[...etat.projet.niveaux].sort((a, b) => a.ordre - b.ordre).map((n) => n.nom)`)).toEqual([
    'Sous-sol',
    'R+1',
    'RDC',
  ]);
  await page.getByRole('button', { name: 'Monter « R+1 »' }).click();
  await expect(noms.nth(0)).toHaveValue('R+1');

  // Renommer et changer la hauteur par défaut.
  await noms.nth(2).fill('Cave');
  await page.getByLabel('Hauteur par défaut').nth(2).fill('210');
  await page.getByLabel('Hauteur par défaut').nth(2).press('Enter');
  expect(await lire(page, `etat.projet.niveaux.find((n) => n.nom === 'Cave')?.hauteurDefaut`)).toBe(210);
  await capturer(page, 'niveaux', 'android');

  // Plan rénové du RDC supprimé, plan actuel gardé.
  await page.getByRole('button', { name: 'Supprimer le plan rénové' }).click();
  await confirmer(page, 'Supprimer le plan rénové du niveau « RDC » ?');
  expect(await lire(page, `etat.projet.niveaux.find((n) => n.nom === 'RDC').renove`)).toBeNull();
  await expect(page.getByRole('button', { name: 'Supprimer le plan rénové' })).toHaveCount(0);

  // Suppression du RDC : ses pièces partent, sa photo reste, sans niveau.
  await page.getByRole('button', { name: 'Supprimer le niveau « RDC »' }).click();
  await confirmer(page, 'Ses 2 pièces (plan actuel) seront supprimées. Sa photo est gardée, sans niveau.');
  await expect(noms).toHaveCount(2);
  await expect
    .poll(() => lire(page, `etat.photos.map((p) => [p.niveauId, p.pieceId, p.position])`))
    .toEqual([[null, null, null]]);
  await expect.poll(() => lire(page, 'etat.enregistrement')).toBe('enregistre');
  await page.reload();
  await expect(page.getByLabel('Nom du niveau')).toHaveCount(2);
  expect(await lire(page, `etat.photos[0].niveauId`)).toBeNull();
});

test('modifie le catalogue des murs et des sols', async ({ page }) => {
  await ouvrirReglages(page);

  // Nouveau type de mur : nom sélectionné pour être retapé directement.
  await page.getByRole('button', { name: 'Ajouter un type de mur' }).click();
  const nouveau = page.getByRole('textbox', { name: 'Nom du type de mur « Nouveau type de mur »' });
  await expect(nouveau).toBeFocused();
  await page.keyboard.type('Doublage 13+48');
  const epaisseur = page.getByRole('textbox', { name: 'Épaisseur de « Doublage 13+48 »' });
  await epaisseur.fill('6,1');
  await epaisseur.press('Enter');
  await expect
    .poll(() => lire(page, `etat.projet.catalogue.typesMurs.at(-1)`))
    .toMatchObject({ nom: 'Doublage 13+48', epaisseur: 6.1 });
  // Cloison 98 mm : la cuisine ; Cloison 72 mm : le séjour (deux plans, une seule pièce) et un côté de la cuisine.
  await expect(page.getByText('type des nouvelles pièces · utilisé dans 1 pièce')).toBeVisible();
  await expect(page.getByText('utilisé dans 2 pièces', { exact: true })).toBeVisible();
  await capturer(page, 'catalogue', 'pc');

  // Type utilisé : confirmation, puis murs réaffectés au type par défaut.
  await page.getByRole('button', { name: 'Supprimer « Cloison 72 mm »' }).click();
  await confirmer(page, 'Ce type de mur est utilisé dans 2 pièces. Les murs concernés passeront en « Cloison 98 mm ».');
  expect(
    await lire(page, `etat.projet.niveaux[0].actuel.pieces.map((p) => [p.typeMurDefautId, p.sommets[1].typeMurId ?? '-'])`),
  ).toEqual([
    ['cloison-98', '-'],
    ['cloison-98', '-'],
  ]);
  expect(await lire(page, `etat.projet.niveaux[0].renove.pieces[0].typeMurDefautId`)).toBe('cloison-98');
  // Type inutilisé : supprimé sans confirmation.
  await page.getByRole('button', { name: 'Supprimer « Mur pierre 40 cm »' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(await lire(page, `etat.projet.catalogue.typesMurs.some((t) => t.id === 'mur-pierre-40')`)).toBe(false);

  // Revêtements : couleur, ajout, suppression d'un revêtement posé.
  await page.getByRole('textbox', { name: 'Nom du revêtement « Carrelage »' }).fill('Carrelage 60×60');
  await page.getByLabel('Couleur de « Carrelage 60×60 »').fill('#336699');
  expect(await lire(page, `etat.projet.catalogue.revetementsSol[0]`)).toMatchObject({
    nom: 'Carrelage 60×60',
    couleur: '#336699',
  });
  await page.getByRole('button', { name: 'Ajouter un revêtement' }).click();
  await expect(page.getByRole('textbox', { name: 'Nom du revêtement « Nouveau revêtement »' })).toBeFocused();
  await page.getByRole('button', { name: 'Supprimer « Parquet »' }).click();
  await confirmer(page, 'Ce revêtement est posé dans 1 pièce, qui passeront en « non renseigné ».');
  expect(await lire(page, `etat.projet.niveaux.flatMap((n) => [...n.actuel.pieces, ...(n.renove?.pieces ?? [])]).map((p) => p.revetementSolId)`)).toEqual([
    null,
    null,
    null,
  ]);
  await expect.poll(() => lire(page, 'etat.enregistrement')).toBe('enregistre');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Nom du revêtement « Carrelage 60×60 »' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Nom du type de mur « Doublage 13+48 »' })).toBeVisible();
});

test('règle le métré : déduction des ouvertures et seuil', async ({ page }) => {
  await ouvrirReglages(page);
  const interrupteur = page.getByRole('switch', { name: /Déduire les ouvertures des surfaces à peindre/ });
  await expect(interrupteur).toBeChecked();
  const seuil = page.getByLabel('Ne pas déduire les ouvertures de moins de');
  await seuil.fill('0,5');
  await seuil.press('Enter');
  expect(await lire(page, 'etat.projet.parametres')).toEqual({ deduireOuvertures: true, seuilDeductionOuverture: 0.5 });
  await interrupteur.uncheck();
  await expect(seuil).toHaveCount(0);
  expect(await lire(page, 'etat.projet.parametres.deduireOuvertures')).toBe(false);
});

test('exporte le chantier puis le supprime', async ({ page }) => {
  const id = await ouvrirReglages(page, 'Villa à supprimer');
  const [telechargement] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exporter le chantier' }).click(),
  ]);
  expect(telechargement.suggestedFilename()).toMatch(/^villa-a-supprimer-\d{4}-\d{2}-\d{2}\.abse\.json$/);
  await expect(page.getByText(/enregistré dans les téléchargements/)).toBeVisible();

  await page.getByRole('button', { name: 'Supprimer le chantier' }).click();
  await confirmer(page, 'Supprimer « Villa à supprimer » ?', 'Supprimer définitivement');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText('Aucun chantier pour l’instant')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Aucun chantier pour l’instant')).toBeVisible();
  expect(await lire(page, `etat.projets.some((p) => p.id === '${id}')`)).toBe(false);
});
