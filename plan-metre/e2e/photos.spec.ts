import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { creerChantier } from './outils';

// Écran Photos : ajout (appareil photo ou import), légende, rattachement,
// visionneuse, persistance après rechargement.
//
// CAPTURES_PHOTOS=<dossier> enregistre aussi des captures d'écran.

const DOSSIER_CAPTURES = process.env.CAPTURES_PHOTOS;

/** PNG RVB généré à la volée : `couleur(x, y)` donne la couleur de chaque pixel. */
function png(largeur: number, hauteur: number, couleur: (x: number, y: number) => [number, number, number]): Buffer {
  const lignes = Buffer.alloc((largeur * 3 + 1) * hauteur);
  let o = 0;
  for (let y = 0; y < hauteur; y++) {
    lignes[o++] = 0; // filtre « aucun »
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
  entete[8] = 8; // 8 bits par canal
  entete[9] = 2; // RVB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', entete),
    morceau('IDAT', deflateSync(lignes)),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}

/** Mur enduit avec une fissure, une fenêtre ou un sol carrelé, pour des vignettes lisibles. */
const MOTIFS: ((x: number, y: number) => [number, number, number])[] = [
  (x, y) => (Math.abs(y - 120 - 30 * Math.sin(x / 25)) < 2 ? [70, 60, 55] : [232 - y / 8, 222 - y / 8, 205 - y / 10]),
  (x, y) => (x > 90 && x < 230 && y > 50 && y < 190 ? (x % 70 < 4 || y % 70 < 4 ? [240, 240, 240] : [150, 190, 225]) : [215, 205, 190]),
  (x, y) => ((Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? [200, 185, 160] : [175, 160, 135]),
  (x, y) => [60 + x / 4, 90 + y / 4, 120 + (x + y) / 8],
];

function fichierPhoto(nom: string, motif = 0) {
  return { name: nom, mimeType: 'image/png', buffer: png(320, 240, MOTIFS[motif % MOTIFS.length]) };
}

const DEUX_NIVEAUX = `
  const rdc = projet.niveaux[0];
  rdc.actuel.pieces.push(
    fabrique.pieceRectangle('Séjour', 500, 400),
    fabrique.pieceRectangle('Cuisine', 300, 400, { origine: { x: 500, y: 0 } }),
  );
  const etage = fabrique.nouveauNiveau('R+1', 1);
  etage.actuel.pieces.push(fabrique.pieceRectangle('Chambre', 400, 300));
  projet.niveaux.push(etage);
  projet.adresse = '12 rue des Lilas, Montpellier';
`;

async function capturer(page: Page, nom: string, projet: 'android' | 'pc') {
  if (!DOSSIER_CAPTURES || test.info().project.name !== projet) return;
  // Capture sans notification éphémère par-dessus.
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6_000 });
  await page.screenshot({ path: `${DOSSIER_CAPTURES}/photos-${nom}.png` });
}

async function ouvrirPhotos(page: Page, nom = 'Villa photos'): Promise<string> {
  const id = await creerChantier(page, nom, DEUX_NIVEAUX);
  await page.goto(`./#/chantier/${id}/photos`);
  await expect(page.getByRole('heading', { name: /^Photos/ })).toBeVisible();
  return id;
}

/** Vignettes affichées (images chargées). */
async function attendreVignettes(page: Page, nombre: number) {
  const images = page.locator('.photos-vignette img');
  await expect(images).toHaveCount(nombre);
  for (let i = 0; i < nombre; i++) {
    await expect(images.nth(i)).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => images.nth(i).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
}

test('ajoute une photo, lui donne une légende et la retrouve après rechargement', async ({ page }) => {
  await ouvrirPhotos(page);
  await expect(page.getByText('Aucune photo pour ce chantier')).toBeVisible();

  // Rattachement : niveau courant par défaut, pièce choisie.
  const ajout = page.getByRole('region', { name: 'Ajouter des photos' });
  await expect(ajout.getByLabel('Niveau')).toHaveValue(/.+/);
  await expect(ajout.getByLabel('Niveau').locator('option:checked')).toHaveText('RDC');
  await ajout.getByLabel('Pièce (facultatif)').selectOption({ label: 'Séjour' });

  // « Prendre une photo » ouvre l'appareil photo (sélecteur de fichier avec capture).
  const [selecteur] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Prendre une photo' }).click(),
  ]);
  expect(selecteur.isMultiple()).toBe(false);
  await selecteur.setFiles(fichierPhoto('fissure.png', 0));

  await attendreVignettes(page, 1);
  await expect(page.getByText('Photo ajoutée')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^RDC/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Séjour/ })).toBeVisible();

  // Visionneuse : image complète, légende.
  await page.locator('.photos-vignette').first().click();
  const visionneuse = page.getByRole('dialog', { name: 'Photo 1 sur 1' });
  await expect(visionneuse).toBeVisible();
  await expect(visionneuse.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(visionneuse.getByText(/^Photo du \d{1,2}(er)? \S+ \d{4} à \d{2}:\d{2}$/)).toBeVisible();
  await expect(visionneuse.getByLabel('Pièce')).toHaveValue(/.+/);
  await visionneuse.getByLabel('Légende').fill('Fissure au-dessus de la porte');
  await capturer(page, 'visionneuse', 'android');
  await capturer(page, 'visionneuse-pc', 'pc');
  await visionneuse.getByRole('button', { name: 'Fermer la photo' }).click();
  await expect(visionneuse).toHaveCount(0);
  await expect(page.locator('.photos-vignette-legende')).toHaveText('Fissure au-dessus de la porte');

  // Enregistrée dans IndexedDB : elle survit au rechargement.
  await expect
    .poll(() => page.evaluate(() => (window as any).__etat.getState().photos[0]?.legende))
    .toBe('Fissure au-dessus de la porte');
  await page.reload();
  await attendreVignettes(page, 1);
  await expect(page.locator('.photos-vignette-legende')).toHaveText('Fissure au-dessus de la porte');
  await expect(page.getByRole('heading', { name: /^Séjour/ })).toBeVisible();
  await page.getByRole('button', { name: /Fissure au-dessus de la porte \(photo du/ }).click();
  await expect(page.getByRole('dialog').getByLabel('Légende')).toHaveValue('Fissure au-dessus de la porte');
});

test('importe plusieurs photos, les range par niveau et supprime', async ({ page }) => {
  await ouvrirPhotos(page, 'Résidence Les Pins');
  const ajout = page.getByRole('region', { name: 'Ajouter des photos' });
  await ajout.getByLabel('Pièce (facultatif)').selectOption({ label: 'Cuisine' });

  const [selecteur] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Importer' }).click(),
  ]);
  expect(selecteur.isMultiple()).toBe(true);
  await selecteur.setFiles([fichierPhoto('a.png', 1), fichierPhoto('b.png', 2), fichierPhoto('c.png', 3)]);
  await attendreVignettes(page, 3);
  await expect(page.getByText('3 photos ajoutées')).toBeVisible();

  // Photos sans pièce sur le même niveau.
  await ajout.getByLabel('Pièce (facultatif)').selectOption({ label: 'Aucune pièce' });
  await page.locator('input[data-role="photo-import"]').setInputFiles([fichierPhoto('d.png', 0)]);
  await attendreVignettes(page, 4);
  await expect(page.getByRole('heading', { name: /^Sans pièce/ })).toBeVisible();

  // Un fichier qui n'est pas une image est signalé sans bloquer les autres.
  await page
    .locator('input[data-role="photo-import"]')
    .setInputFiles([{ name: 'releve.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('pas une image') }, fichierPhoto('e.png', 1)]);
  await attendreVignettes(page, 5);
  await expect(page.getByRole('alert')).toContainText('« releve.jpg » n’a pas pu être ajoutée');
  await page.getByRole('button', { name: 'Masquer le message' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await capturer(page, 'grille', 'android');
  await capturer(page, 'grille-pc', 'pc');

  // Visionneuse : défilement et changement de niveau.
  await page.locator('.photos-vignette').nth(1).click();
  const dialogue = page.getByRole('dialog', { name: 'Photo 2 sur 5' });
  await expect(dialogue).toBeVisible();
  await dialogue.getByRole('button', { name: 'Photo suivante' }).click();
  await expect(page.getByRole('dialog', { name: 'Photo 3 sur 5' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'Photo 2 sur 5' })).toBeVisible();
  await page.getByRole('dialog').getByLabel('Niveau').selectOption({ label: 'R+1' });
  // La photo rejoint le R+1, en dernier dans l'ordre de la grille.
  await expect(page.getByRole('dialog', { name: 'Photo 5 sur 5' })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Pièce')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: /^R\+1/ })).toBeVisible();
  await expect(page.locator('.photos-groupe').nth(1).locator('.photos-vignette')).toHaveCount(1);

  // Suppression avec confirmation.
  await page.locator('.photos-vignette').first().click();
  await page.getByRole('dialog', { name: 'Photo 1 sur 5' }).getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Supprimer cette photo ?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Supprimer' }).click();
  // La visionneuse passe à la photo suivante.
  await expect(page.getByRole('dialog', { name: 'Photo 1 sur 4' })).toBeVisible();
  await page.getByRole('button', { name: 'Fermer la photo' }).click();
  await attendreVignettes(page, 4);
  await page.reload();
  await attendreVignettes(page, 4);
});

test('« Voir sur le plan » sélectionne la photo épinglée', async ({ page }) => {
  const id = await ouvrirPhotos(page);
  await page.locator('input[data-role="photo-import"]').setInputFiles([fichierPhoto('a.png', 0)]);
  await attendreVignettes(page, 1);
  // Pas d'épingle : pas de lien vers le plan.
  await page.locator('.photos-vignette').click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Voir sur le plan' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Fermer la photo' }).click();

  // Épinglée sur le plan du R+1 (comme le ferait l'éditeur de plan).
  const photoId = await page.evaluate(async () => {
    const etat = (window as any).__etat.getState();
    const etage = etat.projet.niveaux.find((n: any) => n.nom === 'R+1');
    const photo = etat.photos[0];
    await etat.modifierPhoto(photo.id, { niveauId: etage.id, position: { x: 120, y: 80 } });
    return photo.id as string;
  });
  await expect(page.locator('.photos-vignette-epingle')).toBeVisible();
  await page.locator('.photos-vignette').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Voir sur le plan' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));
  const etat = await page.evaluate(() => {
    const e = (window as any).__etat.getState();
    return { selection: e.selection, niveau: e.projet.niveaux.find((n: any) => n.id === e.niveauId)?.nom };
  });
  expect(etat).toEqual({ selection: { type: 'photo', photoId }, niveau: 'R+1' });
  // « Retour » ramène aux photos, sans visionneuse.
  await page.goBack();
  await expect(page).toHaveURL(/\/photos$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('le retour du téléphone ferme la visionneuse sans quitter l’écran', async ({ page }) => {
  await ouvrirPhotos(page);
  await page.locator('input[data-role="photo-import"]').setInputFiles([fichierPhoto('a.png', 2)]);
  await attendreVignettes(page, 1);
  await page.locator('.photos-vignette').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/photos$/);
  await expect(page.getByRole('heading', { name: /^Photos/ })).toBeVisible();
});
