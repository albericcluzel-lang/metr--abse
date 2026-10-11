import { readFile } from 'node:fs/promises';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

// Accueil : création d'un chantier, cartes, recherche, export / import
// (sauvegarde et transfert téléphone ↔ PC), suppression, installation.
//
// CAPTURES_ACCUEIL=<dossier> enregistre aussi des captures d'écran.

const DOSSIER_CAPTURES = process.env.CAPTURES_ACCUEIL;

/** PNG RVB généré à la volée (même principe que dans photos.spec.ts). */
function png(largeur: number, hauteur: number, couleur: (x: number, y: number) => [number, number, number]): Buffer {
  const lignes = Buffer.alloc((largeur * 3 + 1) * hauteur);
  let o = 0;
  for (let y = 0; y < hauteur; y++) {
    lignes[o++] = 0;
    for (let x = 0; x < largeur; x++) {
      const [r, v, b] = couleur(x, y);
      lignes[o++] = r;
      lignes[o++] = v;
      lignes[o++] = b;
    }
  }
  const morceau = (type: string, donnees: Buffer) => {
    const longueur = Buffer.alloc(4);
    longueur.writeUInt32BE(donnees.length);
    const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
    const controle = Buffer.alloc(4);
    controle.writeUInt32BE(crc32(corps));
    return Buffer.concat([longueur, corps, controle]);
  };
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8;
  entete[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', entete),
    morceau('IDAT', deflateSync(lignes)),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}

async function capturer(page: Page, nom: string, projet: 'android' | 'pc') {
  if (!DOSSIER_CAPTURES || test.info().project.name !== projet) return;
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6_000 });
  await page.screenshot({ path: `${DOSSIER_CAPTURES}/accueil-${nom}.png` });
}

async function ouvrirAccueil(page: Page) {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__etat?.getState().pret);
  await expect(page.getByRole('heading', { name: /^Mes chantiers/ })).toBeVisible();
}

async function attendreEnregistrement(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).__etat.getState().enregistrement)).toBe('enregistre');
}

const noms = (page: Page) => page.locator('.accueil-carte-nom');

async function menuCarte(page: Page, nom: string, action: string) {
  await page.getByRole('button', { name: `Actions pour « ${nom} »` }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

/** Chantiers amorcés directement dans l'état (cartes à afficher). */
async function amorcerChantiers(page: Page) {
  await page.evaluate(async () => {
    const etat = (window as any).__etat.getState();
    const f = (window as any).__fabrique;
    const villa = await etat.creerProjet({ nom: 'Villa Dupont', client: 'M. Dupont', adresse: '12 rue des Lilas, Montpellier' });
    const sejour = f.pieceRectangle('Séjour', 500, 400);
    sejour.revetementSolId = 'parquet';
    const cuisine = f.pieceRectangle('Cuisine', 300, 250, { origine: { x: 500, y: 0 } });
    cuisine.revetementSolId = 'carrelage';
    villa.niveaux[0].actuel.pieces.push(sejour, cuisine, f.pieceRectangle('Salle de bain', 204, 175, { origine: { x: 500, y: 250 } }));
    villa.niveaux.push(f.nouveauNiveau('R+1', 1));
    villa.modifieLe = new Date(Date.now() - 86_400_000).toISOString();
    await etat.importerProjet(villa);
    const pins = await etat.creerProjet({ nom: 'Résidence Les Pins', client: 'SCI Hélios' });
    const studio = f.pieceRectangle('Studio', 450, 320);
    pins.niveaux[0].actuel.pieces.push(studio, f.pieceRectangle('Salle d’eau', 180, 160, { origine: { x: 450, y: 0 } }));
    await etat.importerProjet(pins);
    await etat.creerProjet({ nom: 'Appartement Comédie', adresse: '3 place de la Comédie, Montpellier' });
  });
}

test('parcours complet : création, réglages, photo, export, import en copie, suppression', async ({ page }) => {
  await ouvrirAccueil(page);
  await expect(page.getByText('Aucun chantier pour l’instant')).toBeVisible();
  await capturer(page, 'vide', 'android');

  // Création depuis l'accueil : le nom est obligatoire.
  await page.getByRole('button', { name: 'Nouveau chantier' }).click();
  const feuille = page.getByRole('dialog', { name: 'Nouveau chantier' });
  await feuille.getByRole('button', { name: 'Créer le chantier' }).click();
  await expect(feuille.getByText('Donnez un nom au chantier pour le retrouver dans la liste.')).toBeVisible();
  await feuille.getByLabel('Nom du chantier (obligatoire)').fill('Villa Test');
  await feuille.getByLabel('Client').fill('M. Martin');
  await feuille.getByLabel('Adresse du chantier').fill('5 quai de Bosc, Sète');
  await feuille.getByLabel('Adresse du chantier').press('Enter');
  await expect(page).toHaveURL(/#\/chantier\/[^/]+$/);
  await expect(page.locator('.barre-haut-titre')).toContainText('Villa Test');
  const id = decodeURIComponent(page.url().split('/chantier/')[1]);

  // Réglages : renommer, ajouter un niveau.
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name: 'Réglages du chantier' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}/parametres$`));
  await page.getByLabel('Nom du chantier').fill('Villa Martin');
  await page.getByRole('button', { name: 'Ajouter un niveau' }).click();
  await page.getByRole('dialog', { name: 'Nouveau niveau' }).getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByLabel('Nom du niveau')).toHaveCount(2);

  // Photo : PNG généré, vignette, légende.
  await page.getByRole('button', { name: 'Retour au plan' }).click();
  await page.locator('.nav-bas').getByRole('button', { name: /Photos/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}/photos$`));
  await page.locator('input[data-role="photo-import"]').setInputFiles({
    name: 'facade.png',
    mimeType: 'image/png',
    buffer: png(240, 180, (x, y) => (y > 120 ? [180, 160, 130] : [225 - x / 6, 215 - y / 6, 195])),
  });
  const vignette = page.locator('.photos-vignette img');
  await expect(vignette).toHaveAttribute('src', /^blob:/);
  await page.locator('.photos-vignette').click();
  await page.getByRole('dialog').getByLabel('Légende').fill('Façade sud');
  await page.getByRole('button', { name: 'Fermer la photo' }).click();
  await expect(page.locator('.photos-vignette-legende')).toHaveText('Façade sud');

  // Retour à l'accueil : la carte résume le chantier.
  await page.getByRole('button', { name: 'Retour au plan' }).click();
  await page.getByRole('button', { name: 'Mes chantiers' }).click();
  await expect(noms(page)).toHaveText(['Villa Martin']);
  const carte = page.locator('.accueil-carte');
  await expect(carte).toContainText('5 quai de Bosc, Sète');
  await expect(carte).toContainText('2 niveaux · 0 pièce');
  await expect(carte).toContainText(/Modifié aujourd’hui à \d{2}:\d{2}/);
  await attendreEnregistrement(page);

  // Export : téléchargement du fichier de sauvegarde, photo comprise.
  const [telechargement] = await Promise.all([page.waitForEvent('download'), menuCarte(page, 'Villa Martin', 'Exporter')]);
  expect(telechargement.suggestedFilename()).toMatch(/^villa-martin-\d{4}-\d{2}-\d{2}\.abse\.json$/);
  const chemin = await telechargement.path();
  const contenu = JSON.parse(await readFile(chemin, 'utf8'));
  expect(contenu).toMatchObject({ format: 'abse-plan-metre', version: 1, projet: { id, nom: 'Villa Martin' } });
  expect(contenu.projet.niveaux).toHaveLength(2);
  expect(contenu.photos).toHaveLength(1);
  expect(contenu.photos[0].meta.legende).toBe('Façade sud');
  expect(contenu.photos[0].complete).toMatch(/^data:image\/jpeg;base64,/);

  // Import du même fichier : le chantier existe, on le garde en copie.
  const [selecteur] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Importer un chantier' }).click()]);
  await selecteur.setFiles(chemin);
  const conflit = page.getByRole('dialog', { name: 'Ce chantier est déjà sur l’appareil' });
  await expect(conflit).toContainText('« Villa Martin » existe déjà sur cet appareil');
  await expect(conflit).toContainText('avec 1 photo');
  await capturer(page, 'import', 'android');
  await conflit.getByRole('button', { name: 'Importer comme copie' }).click();
  await expect(page.getByText('Chantier « Villa Martin (copie) » importé avec 1 photo')).toBeVisible();
  await expect(noms(page)).toHaveCount(2);
  await expect(noms(page)).toContainText(['Villa Martin (copie)', 'Villa Martin']);

  // La copie a ses propres identifiants et sa photo.
  await page.locator('.accueil-carte-principal', { hasText: 'Villa Martin (copie)' }).click();
  await expect(page.locator('.barre-haut-titre')).toContainText('Villa Martin (copie)');
  const idCopie = decodeURIComponent(page.url().split('/chantier/')[1]);
  expect(idCopie).not.toBe(id);
  await page.goto(`./#/chantier/${idCopie}/photos`);
  await expect(page.locator('.photos-vignette img')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('.photos-vignette-legende')).toHaveText('Façade sud');
  expect(await page.evaluate(() => (window as any).__etat.getState().photos.map((p: any) => p.projetId))).toEqual([idCopie]);

  // Suppression du chantier d'origine, avec confirmation.
  await page.goto('./#/');
  await menuCarte(page, 'Villa Martin', 'Supprimer');
  const dialogue = page.getByRole('alertdialog');
  await expect(dialogue).toContainText('Supprimer « Villa Martin » ?');
  await expect(dialogue).toContainText('et 1 photo');
  await dialogue.getByRole('button', { name: 'Supprimer' }).click();
  await expect(noms(page)).toHaveText(['Villa Martin (copie)']);
  await page.reload();
  await expect(noms(page)).toHaveText(['Villa Martin (copie)']);
  // La photo de la copie n'a pas été emportée avec l'original.
  const photosCopie = await page.evaluate(async (pid) => {
    const etat = (window as any).__etat.getState();
    await etat.ouvrirProjet(pid);
    return (window as any).__etat.getState().photos.length;
  }, idCopie);
  expect(photosCopie).toBe(1);
});

test('affiche les cartes des chantiers, du plus récent au plus ancien', async ({ page }) => {
  await ouvrirAccueil(page);
  await amorcerChantiers(page);
  await expect(noms(page)).toHaveText(['Appartement Comédie', 'Résidence Les Pins', 'Villa Dupont']);
  const villa = page.locator('.accueil-carte', { hasText: 'Villa Dupont' });
  await expect(villa).toContainText('12 rue des Lilas, Montpellier');
  await expect(villa.locator('.accueil-carte-detail')).toHaveText('2 niveaux · 3 pièces · 31,07 m²');
  await expect(villa).toContainText(/Modifié hier à \d{2}:\d{2}/);
  await expect(villa.locator('.accueil-apercu polygon')).toHaveCount(3);
  // Sans adresse, le client est affiché.
  await expect(page.locator('.accueil-carte', { hasText: 'Résidence Les Pins' })).toContainText('SCI Hélios');
  await expect(page.locator('.accueil-carte', { hasText: 'Appartement Comédie' }).locator('.accueil-carte-detail')).toHaveText(
    '1 niveau · 0 pièce',
  );
  await expect(page.getByText(/Vos chantiers sont enregistrés sur cet appareil uniquement/)).toBeVisible();
  await expect(page.getByText(/Espace utilisé : \d/)).toBeVisible();
  // Pas de recherche en dessous de 6 chantiers.
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await capturer(page, 'liste', 'android');
  await capturer(page, 'liste-pc', 'pc');

  await page.locator('.accueil-carte-principal', { hasText: 'Villa Dupont' }).click();
  await expect(page.locator('.barre-haut-titre')).toContainText('Villa Dupont');
});

test('cherche parmi plus de 5 chantiers', async ({ page }) => {
  await ouvrirAccueil(page);
  await amorcerChantiers(page);
  await page.evaluate(async () => {
    const etat = (window as any).__etat.getState();
    await etat.creerProjet({ nom: 'Maison Garcia', client: 'Mme Garcia', adresse: 'Lattes' });
    await etat.creerProjet({ nom: 'Bureaux Port Marianne', client: 'Hélios Promotion', adresse: 'Montpellier' });
    await etat.creerProjet({ nom: 'École Jean Moulin', adresse: 'Castelnau-le-Lez' });
  });
  const recherche = page.getByRole('searchbox', { name: 'Rechercher un chantier' });
  await expect(recherche).toBeVisible();
  await recherche.fill('helios');
  await expect(noms(page)).toHaveText(['Bureaux Port Marianne', 'Résidence Les Pins']);
  await recherche.fill('montpellier lilas');
  await expect(noms(page)).toHaveText(['Villa Dupont']);
  await recherche.fill('ecole');
  await expect(noms(page)).toHaveText(['École Jean Moulin']);
  await recherche.fill('Nîmes');
  await expect(noms(page)).toHaveCount(0);
  await expect(page.getByText('Aucun chantier ne correspond à « Nîmes ».')).toBeVisible();
});

test('remplace un chantier existant par le fichier importé', async ({ page }) => {
  await ouvrirAccueil(page);
  await amorcerChantiers(page);
  const [telechargement] = await Promise.all([page.waitForEvent('download'), menuCarte(page, 'Villa Dupont', 'Exporter')]);
  const chemin = await telechargement.path();
  // Modifié après l'export (ex. sur le téléphone, avant de récupérer la version du PC).
  await page.evaluate(async () => {
    const etat = (window as any).__etat.getState();
    const villa = structuredClone(etat.projets.find((p: any) => p.nom === 'Villa Dupont'));
    villa.nom = 'Villa Dupont modifiée';
    villa.niveaux[0].actuel.pieces = [];
    await etat.importerProjet(villa);
  });
  await expect(noms(page)).toContainText(['Villa Dupont modifiée']);
  await page.locator('input[data-role="import-chantier"]').setInputFiles(chemin);
  await page.getByRole('dialog').getByRole('button', { name: 'Remplacer' }).click();
  await expect(page.getByText('Chantier « Villa Dupont » importé')).toBeVisible();
  await expect(noms(page)).toHaveCount(3);
  await expect(page.locator('.accueil-carte', { hasText: 'Villa Dupont' }).locator('.accueil-carte-detail')).toHaveText(
    '2 niveaux · 3 pièces · 31,07 m²',
  );
  await expect(page.getByText('Villa Dupont modifiée')).toHaveCount(0);
});

test('importe directement un chantier absent de l’appareil', async ({ page }) => {
  await ouvrirAccueil(page);
  await amorcerChantiers(page);
  const [telechargement] = await Promise.all([page.waitForEvent('download'), menuCarte(page, 'Résidence Les Pins', 'Exporter')]);
  const chemin = await telechargement.path();
  await menuCarte(page, 'Résidence Les Pins', 'Supprimer');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(noms(page)).toHaveCount(2);
  // Comme sur un autre appareil : pas de question, import direct.
  await page.locator('input[data-role="import-chantier"]').setInputFiles(chemin);
  await expect(page.getByText('Chantier « Résidence Les Pins » importé')).toBeVisible();
  await expect(noms(page)).toHaveCount(3);
  await expect(page.locator('.accueil-carte', { hasText: 'Résidence Les Pins' }).locator('.accueil-carte-detail')).toHaveText(
    '1 niveau · 2 pièces · 17,28 m²',
  );
});

test('refuse un fichier qui n’est pas une sauvegarde de chantier', async ({ page }) => {
  await ouvrirAccueil(page);
  const entree = page.locator('input[data-role="import-chantier"]');
  const dialogue = page.getByRole('dialog', { name: 'Import impossible' });

  await entree.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Liste des courses') });
  await expect(dialogue).toContainText('Fichier illisible');
  await expect(dialogue).toContainText('Fichier : notes.txt');
  await dialogue.locator('.feuille-pied').getByRole('button', { name: 'Fermer' }).click();
  await expect(dialogue).toHaveCount(0);

  await entree.setInputFiles({
    name: 'autre.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'visuary', version: 1 })),
  });
  await expect(dialogue).toContainText('Ce fichier n’est pas une sauvegarde de chantier ABSE Plan & Métré.');
  await dialogue.locator('.feuille-pied').getByRole('button', { name: 'Fermer' }).click();

  await entree.setInputFiles({
    name: 'futur.abse.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'abse-plan-metre', version: 3 })),
  });
  await expect(dialogue).toContainText('version plus récente de l’appli');
  await expect(dialogue.getByRole('button', { name: 'Autre fichier' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialogue).toHaveCount(0);
  await expect(page.getByText('Aucun chantier pour l’instant')).toBeVisible();
});

test('propose d’installer l’appli et mémorise le masquage', async ({ page }) => {
  await ouvrirAccueil(page);
  const carte = page.getByRole('region', { name: 'Installer l’appli' });
  // Sans proposition de Chrome : la marche à suivre.
  await expect(carte).toContainText('Dans Chrome : menu ⋮ → Installer l’application');

  // Chrome propose l'installation (événement simulé).
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(e, {
      prompt: async () => {
        (window as any).__installationDemandee = true;
      },
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    });
    window.dispatchEvent(e);
  });
  const appareil = test.info().project.name === 'android' ? 'ce téléphone' : 'cet ordinateur';
  await carte.getByRole('button', { name: `Installer l’appli sur ${appareil}` }).click();
  await expect(page.getByText('Appli installée : retrouvez-la sur l’écran d’accueil')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__installationDemandee)).toBe(true);

  await carte.getByRole('button', { name: 'Masquer ce conseil' }).click();
  await expect(carte).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Mes chantiers/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Installer l’appli' })).toHaveCount(0);
});
