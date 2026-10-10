import { expect, test, type Locator, type Page } from '@playwright/test';
import { creerChantier } from './outils';

// Écran Métré, amorcé avec la salle de bain de la vidéo de référence
// (2,04 × 1,75 m, cloisons de 98 mm, baignoire et meuble vasque).
//
// CAPTURES_METRE=<dossier> enregistre aussi des captures d'écran.

const DOSSIER_CAPTURES = process.env.CAPTURES_METRE;

const SALLE_DE_BAIN = `
  const p = fabrique.pieceRectangle('Salle de bain', 204, 175, { hauteur: 250, typeMurDefautId: 'cloison-98' });
  p.revetementSolId = 'carrelage';
  const baignoire = fabrique.nouvelEquipement('baignoire', { x: 93.5, y: 26 });
  baignoire.largeur = 187;
  baignoire.profondeur = 52;
  const vasque = fabrique.nouvelEquipement('meuble-vasque', { x: 178, y: 110 });
  vasque.largeur = 46;
  vasque.profondeur = 52;
  vasque.rotation = 90;
  p.equipements.push(baignoire, vasque);
  projet.niveaux[0].actuel.pieces.push(p);
  projet.client = 'Showroom ABSE';
  projet.adresse = '12 avenue de Toulouse, Montpellier';
`;

/** Capture pour un seul des deux projets (téléphone ou PC). */
async function capturer(page: Page, nom: string, projet: 'android' | 'pc', options: { pleinePage?: boolean } = {}) {
  if (!DOSSIER_CAPTURES || test.info().project.name !== projet) return;
  await page.screenshot({ path: `${DOSSIER_CAPTURES}/metre-${nom}.png`, fullPage: options.pleinePage });
}

/** Texte affiché, espaces insécables (fines ou non) du format fr-FR ramenées à des espaces simples. */
async function texte(loc: Locator): Promise<string> {
  return ((await loc.textContent()) ?? '').replace(/[  ]/g, ' ').trim();
}

async function attendreTexte(loc: Locator, attendu: string) {
  await expect(loc).toHaveCount(1);
  await expect.poll(() => texte(loc)).toBe(attendu);
}

/** Case d'une ligne du métré (colonne « valeur » pour un seul plan, « actuel » / « renove » / « ecart » en comparaison). */
function caseMetre(racine: Page | Locator, cle: string, colonne = 'valeur'): Locator {
  return racine.locator(`tr[data-cle="${cle}"] td[data-colonne="${colonne}"]`);
}

async function ouvrirMetre(page: Page, nom = 'Salle de bain expo', preparer = SALLE_DE_BAIN): Promise<string> {
  const id = await creerChantier(page, nom, preparer);
  await page.goto(`./#/chantier/${id}/metre`);
  await expect(page.getByRole('heading', { name: /Métré/ })).toBeVisible();
  return id;
}

/** Valeurs de la vidéo, attendues pour la pièce seule, le RDC et le chantier entier. */
async function verifierValeursVideo(racine: Page | Locator) {
  await attendreTexte(caseMetre(racine, 'surfaces:sol'), '3,57 m²');
  await attendreTexte(caseMetre(racine, 'murs:cloison-98'), '18,95 m²');
  await attendreTexte(caseMetre(racine, 'peinture:cloison-98'), '18,95 m²');
  await attendreTexte(caseMetre(racine, 'peinture:plafond'), '3,57 m²');
  await attendreTexte(caseMetre(racine, 'volume'), '8,93 m³');
  await attendreTexte(caseMetre(racine, 'perimetres:exterieur'), '8,36 m');
  await attendreTexte(caseMetre(racine, 'perimetres:interieur'), '7,58 m');
  await attendreTexte(caseMetre(racine, 'perimetres:plinthes'), '7,58 m');
  await attendreTexte(caseMetre(racine, 'sols:carrelage'), '2,36 m²');
}

test('affiche le métré global de la salle de bain de la vidéo', async ({ page }) => {
  await ouvrirMetre(page);
  await expect(page.getByRole('tab', { name: 'Global' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Plan actuel' })).toHaveAttribute('aria-pressed', 'true');

  // Synthèse en tête : surface totale et nombre de pièces.
  await attendreTexte(page.locator('[data-cle="synthese:surface"]'), '3,57 m²');
  await attendreTexte(page.locator('[data-cle="synthese:pieces"]'), '1');

  await verifierValeursVideo(page);

  // Titres de section en petites capitales, dans l'ordre de la référence.
  const titres = page.locator('.metre-section-titre > span:first-child');
  await expect(titres).toHaveText(
    ['SURFACES', 'SURFACES MURS ET CLOISONS', 'SURFACES À PEINDRE', 'VOLUME', 'CIRCONFÉRENCES', 'REVÊTEMENTS DE SOL'],
    { useInnerText: true },
  );
  await expect(page.locator('[data-section="peinture"] .metre-section-sous-titre')).toHaveText('Hors ouvrants');
  await expect(page.locator('tr[data-cle="sols:carrelage"] th')).toHaveText('Carrelage');

  // Valeurs alignées à droite, chiffres tabulaires.
  const style = await caseMetre(page, 'surfaces:sol').evaluate((el) => {
    const s = getComputedStyle(el);
    return { align: s.textAlign, chiffres: s.fontVariantNumeric };
  });
  expect(style).toEqual({ align: 'right', chiffres: 'tabular-nums' });

  await capturer(page, 'global-android', 'android');
});

test('onglets Par étage et Par pièce, ouverture de la pièce sur le plan', async ({ page }) => {
  const id = await ouvrirMetre(page);

  await page.getByRole('tab', { name: 'Par étage' }).click();
  await expect(page.getByRole('tab', { name: 'Par étage' })).toHaveAttribute('aria-selected', 'true');
  const rdc = page.locator('section.metre-bloc').filter({ has: page.getByRole('heading', { name: 'RDC' }) });
  await expect(rdc).toHaveCount(1);
  await attendreTexte(rdc.locator('.metre-bloc-resume'), '1 pièce · 3,57 m²');
  await verifierValeursVideo(rdc);

  // Les flèches du clavier passent d'un onglet à l'autre.
  await page.getByRole('tab', { name: 'Par étage' }).focus();
  await page.keyboard.press('ArrowRight');
  const parPiece = page.getByRole('tab', { name: 'Par pièce' });
  await expect(parPiece).toHaveAttribute('aria-selected', 'true');
  await expect(parPiece).toBeFocused();

  const carte = page.locator('article.metre-carte');
  await expect(carte).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'RDC' })).toBeVisible();
  await attendreTexte(carte.locator('.metre-carte-resume'), '3,57 m²');
  await verifierValeursVideo(carte);

  // Carte repliable.
  await page.getByRole('button', { name: 'Replier le détail de Salle de bain' }).click();
  await expect(carte.locator('.metre-carte-corps')).toBeHidden();
  const deplier = page.getByRole('button', { name: 'Déplier le détail de Salle de bain' });
  await expect(deplier).toHaveAttribute('aria-expanded', 'false');
  await deplier.click();
  await expect(carte.locator('.metre-carte-corps')).toBeVisible();

  // Toucher le nom : la pièce est sélectionnée sur le plan.
  const pieceId = await page.evaluate(() => (window as any).__etat.getState().projet.niveaux[0].actuel.pieces[0].id);
  await page.getByRole('button', { name: /Salle de bain, voir sur le plan/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));
  const etat = await page.evaluate(() => {
    const e = (window as any).__etat.getState();
    return { selection: e.selection, variante: e.variante, renove: e.projet.niveaux[0].renove };
  });
  expect(etat).toEqual({ selection: { type: 'piece', pieceId }, variante: 'actuel', renove: null });

  // De retour sur le métré, l'onglet choisi est conservé.
  await page.goto(`./#/chantier/${id}/metre`);
  await expect(page.getByRole('tab', { name: 'Par pièce' })).toHaveAttribute('aria-selected', 'true');
});

test('plan rénové : avis tant qu’il n’existe pas, puis comparaison avec écarts', async ({ page }) => {
  await ouvrirMetre(page);
  const avis = page.locator('.metre-avis');

  await page.getByRole('button', { name: 'Plan rénové' }).click();
  await expect(avis).toContainText('Créez le plan rénové depuis l’écran du plan');
  await attendreTexte(caseMetre(page, 'surfaces:sol'), '3,57 m²');

  await page.getByRole('button', { name: 'Comparer' }).click();
  await expect(avis).toContainText('Créez le plan rénové depuis l’écran du plan');
  await attendreTexte(caseMetre(page, 'surfaces:sol', 'ecart'), '=');

  // Rénovation : la salle de bain passe à 2,60 m de long et reçoit une porte.
  await page.evaluate(() => {
    const w = window as any;
    w.__etat.getState().modifierProjet((p: any) => {
      const n = p.niveaux[0];
      n.renove = structuredClone(n.actuel);
      const piece = n.renove.pieces[0];
      piece.sommets[1].x = 260;
      piece.sommets[2].x = 260;
      piece.ouvertures.push(w.__fabrique.nouvelleOuverture('porte', 2, 50));
    });
  });
  await expect(avis).toHaveCount(0);

  const enTete = page.locator('[data-section="surfaces"] thead th');
  await expect(enTete).toHaveText(['Désignation', 'Actuel', 'Rénové', 'Écart']);

  await attendreTexte(caseMetre(page, 'surfaces:sol', 'actuel'), '3,57 m²');
  await attendreTexte(caseMetre(page, 'surfaces:sol', 'renove'), '4,55 m²');
  await attendreTexte(caseMetre(page, 'surfaces:sol', 'ecart'), '+0,98 m²');
  await expect(caseMetre(page, 'surfaces:sol', 'ecart')).toHaveClass(/non-nul/);
  await attendreTexte(caseMetre(page, 'murs:cloison-98', 'ecart'), '+2,80 m²');
  // La porte n'existe que dans le plan rénové.
  await attendreTexte(caseMetre(page, 'ouvertures:porte|83|204', 'actuel'), '—');
  await attendreTexte(caseMetre(page, 'ouvertures:porte|83|204', 'renove'), '1 u');
  await attendreTexte(caseMetre(page, 'ouvertures:porte|83|204', 'ecart'), '+1 u');
  // Même nombre de pièces : écart nul, non mis en évidence.
  const ecartPieces = page.locator('tr[data-cle="synthese:pieces"] td[data-colonne="ecart"]');
  await attendreTexte(ecartPieces, '=');
  await expect(ecartPieces).not.toHaveClass(/non-nul/);

  await capturer(page, 'comparer-android', 'android');

  await page.getByRole('tab', { name: 'Par étage' }).click();
  await attendreTexte(page.locator('.metre-bloc-resume'), 'Actuel : 1 pièce · Rénové : 1 pièce');
  await attendreTexte(caseMetre(page, 'sols:carrelage', 'ecart'), '+0,98 m²');

  await page.getByRole('tab', { name: 'Par pièce' }).click();
  await attendreTexte(page.locator('.metre-carte-resume'), '+0,98 m²');
  await attendreTexte(caseMetre(page.locator('article.metre-carte'), 'surfaces:sol', 'renove'), '4,55 m²');

  // Plan rénové seul.
  await page.getByRole('button', { name: 'Plan rénové' }).click();
  await attendreTexte(caseMetre(page, 'surfaces:sol'), '4,55 m²');
  await attendreTexte(caseMetre(page, 'peinture:cloison-98'), '20,06 m²');
});

test('copier le métré et l’imprimer', async ({ page }) => {
  await ouvrirMetre(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__copies = [];
    w.__impressions = 0;
    w.__refuserCopie = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          if (w.__refuserCopie) throw new Error('refusé');
          w.__copies.push(t);
        },
      },
    });
    window.print = () => {
      w.__impressions++;
    };
  });

  await page.getByRole('button', { name: 'Copier' }).click();
  await expect(page.getByRole('status')).toContainText('Métré copié');
  const copie: string = await page.evaluate(() => (window as any).__copies[0]);
  const lignes = copie.split('\n');
  expect(lignes[0]).toBe('Métré — Salle de bain expo');
  expect(lignes).toContain('Désignation\tQuantité\tUnité');
  expect(lignes).toContain('Surface au sol\t3,57\tm²');
  expect(lignes).toContain('Volume\t8,93\tm³');
  expect(lignes).toContain('Carrelage\t2,36\tm²');

  await page.evaluate(() => ((window as any).__refuserCopie = true));
  await page.getByRole('button', { name: 'Copier' }).click();
  await expect(page.getByRole('status')).toContainText('Copie impossible');

  await page.getByRole('button', { name: 'Imprimer / PDF' }).click();
  expect(await page.evaluate(() => (window as any).__impressions)).toBe(1);

  // Feuille d'impression : en-tête du chantier, pas de boutons, cartes repliées dépliées.
  await page.getByRole('tab', { name: 'Par pièce' }).click();
  await page.getByRole('button', { name: 'Replier le détail de Salle de bain' }).click();
  await expect(page.locator('.metre-carte-corps')).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  const entete = page.locator('.metre-impression');
  await expect(entete).toBeVisible();
  await expect(entete).toContainText('Métré — Salle de bain expo');
  await expect(entete).toContainText('12 avenue de Toulouse, Montpellier');
  await expect(entete).toContainText('Plan actuel · Par pièce · édité le');
  await expect(page.locator('.barre-haut')).toBeHidden();
  await expect(page.locator('.metre-onglets')).toBeHidden();
  await expect(page.locator('.metre-controles')).toBeHidden();
  await expect(page.locator('.metre-carte-corps')).toBeVisible();
  await expect(page.locator('.metre-carte-bascule')).toBeHidden();
  await capturer(page, 'impression-pc', 'pc', { pleinePage: true });
  await page.emulateMedia({ media: 'screen' });
  await expect(entete).toBeHidden();
});

test('guide du métré et lien vers les réglages', async ({ page }) => {
  const id = await ouvrirMetre(page);
  await page.getByRole('button', { name: 'Voir le guide' }).click();
  const guide = page.getByRole('dialog', { name: 'Guide du métré' });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('Surface au sol');
  await expect(guide).toContainText('Plinthes');
  await expect(guide).toContainText('Un niveau sans plan rénové est réputé inchangé');
  await expect(guide).toContainText('Toutes les ouvertures sont déduites');
  await guide.getByRole('button', { name: 'Modifier les réglages' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}/parametres$`));
});

test('chantier sans pièce : état vide et retour au plan', async ({ page }) => {
  const id = await ouvrirMetre(page, 'Chantier vide', '');
  await expect(page.getByRole('heading', { name: 'Aucune pièce' })).toBeVisible();
  await expect(page.getByText('Relevez ou dessinez une pièce pour obtenir le métré.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copier' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Imprimer / PDF' })).toBeDisabled();
  await page.getByRole('button', { name: 'Aller au plan' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));

  // Le bouton retour de la barre ramène aussi au plan.
  await page.goto(`./#/chantier/${id}/metre`);
  await page.getByRole('button', { name: 'Retour au plan' }).click();
  await expect(page).toHaveURL(new RegExp(`#/chantier/${id}$`));
});
