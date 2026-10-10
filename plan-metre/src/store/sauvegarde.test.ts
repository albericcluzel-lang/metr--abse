import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { pieceRectangle } from '../model/fabrique';
import type { Photo } from '../model/types';
import { useEtat } from './etat';
import * as persistance from './persistance';
import {
  blobVersDataUrl,
  dataUrlVersBlob,
  ErreurSauvegarde,
  exporterChantier,
  importerSauvegarde,
  lireSauvegarde,
  nomCopie,
  nomFichierSauvegarde,
  preparerImport,
  validerSauvegarde,
  type FichierSauvegarde,
} from './sauvegarde';

async function reinitialiser() {
  // Écrit d'abord l'enregistrement différé éventuel du test précédent, pour qu'il ne resurgisse pas.
  await useEtat.getState().enregistrerMaintenant();
  for (const p of await persistance.listerProjets()) await persistance.supprimerProjet(p.id);
  useEtat.setState({ projets: [], projet: null, passe: [], futur: [], photos: [], selection: null, variante: 'actuel' });
}

function octets(n: number): Uint8Array<ArrayBuffer> {
  const o = new Uint8Array(n);
  for (let i = 0; i < n; i++) o[i] = (i * 31 + (i >> 8)) % 256;
  return o;
}

async function contenu(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

function photo(id: string, projetId: string, niveauId: string | null, legende = ''): Photo {
  return {
    id,
    projetId,
    niveauId,
    pieceId: null,
    position: { x: 120, y: 80 },
    legende,
    date: '2026-10-10T08:30:00.000Z',
    largeur: 40,
    hauteur: 30,
  };
}

/** Chantier enregistré avec une pièce et une photo ; renvoie son identifiant. */
async function chantierAvecPhoto(nom = 'Villa Dupont'): Promise<string> {
  const p = await useEtat.getState().creerProjet({ nom, client: 'M. Dupont', adresse: 'Montpellier' });
  p.niveaux[0].actuel.pieces.push(pieceRectangle('Séjour', 500, 400));
  await useEtat.getState().importerProjet(p);
  await persistance.enregistrerPhoto(photo('ph-1', p.id, p.niveaux[0].id, 'Façade'), {
    complete: new Blob([octets(50_000)], { type: 'image/jpeg' }),
    vignette: new Blob([octets(800)], { type: 'image/jpeg' }),
  });
  return p.id;
}

async function exporter(id: string): Promise<FichierSauvegarde> {
  const e = await exporterChantier(id, new Date(2026, 9, 10, 14, 5));
  return lireSauvegarde(await e.blob.text());
}

describe('conversion Blob ↔ data URL', () => {
  it('fait l’aller-retour sur des données binaires plus longues qu’un morceau', async () => {
    const source = new Blob([octets(100_000)], { type: 'image/jpeg' });
    const url = await blobVersDataUrl(source);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const relu = dataUrlVersBlob(url);
    expect(relu.type).toBe('image/jpeg');
    expect(await contenu(relu)).toEqual(await contenu(source));
  });

  it('gère le blob vide et l’absence de type', async () => {
    const url = await blobVersDataUrl(new Blob([]));
    expect(url).toBe('data:application/octet-stream;base64,');
    expect(dataUrlVersBlob(url).size).toBe(0);
  });

  it('refuse une data URL invalide', () => {
    expect(() => dataUrlVersBlob('data:image/png,pas-en-base64')).toThrow(ErreurSauvegarde);
    expect(() => dataUrlVersBlob('data:image/png;base64,@@@')).toThrow(ErreurSauvegarde);
    expect(() => dataUrlVersBlob('http://exemple.fr/a.png')).toThrow(ErreurSauvegarde);
  });
});

describe('nom du fichier', () => {
  it('reprend le nom du chantier sans accents ni espaces, avec la date locale', () => {
    const d = new Date(2026, 0, 5, 23, 50);
    expect(nomFichierSauvegarde('Villa Dupont — Œuvre / R+1', d)).toBe('villa-dupont-oeuvre-r-1-2026-01-05.abse.json');
    expect(nomFichierSauvegarde('  ', d)).toBe('chantier-2026-01-05.abse.json');
    expect(nomFichierSauvegarde('Élise & Frères', d)).toBe('elise-freres-2026-01-05.abse.json');
  });

  it('suffixe les copies sans les empiler', () => {
    expect(nomCopie('Villa', [])).toBe('Villa (copie)');
    expect(nomCopie('Villa', ['Villa', 'Villa (copie)'])).toBe('Villa (copie 2)');
    expect(nomCopie('Villa (copie)', ['Villa', 'Villa (copie)', 'Villa (copie 2)'])).toBe('Villa (copie 3)');
  });
});

describe('export et import d’un chantier', () => {
  beforeEach(reinitialiser);

  it('fait l’aller-retour export → import avec les photos', async () => {
    const id = await chantierAvecPhoto();
    const e = await exporterChantier(id, new Date(2026, 9, 10, 14, 5));
    expect(e.nomFichier).toBe('villa-dupont-2026-10-10.abse.json');
    expect(e.nombrePhotos).toBe(1);
    expect(e.blob.type).toBe('application/json');

    const s = lireSauvegarde(await e.blob.text());
    expect(s.format).toBe('abse-plan-metre');
    expect(s.version).toBe(1);
    expect(s.photos[0].meta.legende).toBe('Façade');

    // Sur un autre appareil : rien n'existe encore.
    await useEtat.getState().supprimerProjet(id);
    const importe = await importerSauvegarde(s, 'nouveau');
    expect(importe.id).toBe(id);
    expect(useEtat.getState().projets.map((p) => p.nom)).toEqual(['Villa Dupont']);
    const relu = await persistance.lireProjet(id);
    expect(relu!.niveaux[0].actuel.pieces[0].nom).toBe('Séjour');
    expect(relu!.client).toBe('M. Dupont');
    const photos = await persistance.listerPhotos(id);
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ id: 'ph-1', projetId: id, legende: 'Façade', position: { x: 120, y: 80 } });
    const images = await persistance.lireImages('ph-1');
    expect(await contenu(images!.complete)).toEqual(Array.from(octets(50_000)));
    expect(await contenu(images!.vignette)).toEqual(Array.from(octets(800)));
  });

  it('exporte la version en mémoire du chantier ouvert', async () => {
    const id = await chantierAvecPhoto();
    await useEtat.getState().ouvrirProjet(id);
    useEtat.getState().modifierProjet((p) => (p.nom = 'Villa rénovée'));
    // Pas encore écrit dans IndexedDB (enregistrement différé).
    const s = await exporter(id);
    expect(s.projet.nom).toBe('Villa rénovée');
  });

  it('importe comme copie avec de nouveaux identifiants', async () => {
    const id = await chantierAvecPhoto();
    const s = await exporter(id);
    const copie = await importerSauvegarde(s, 'copie');

    expect(copie.id).not.toBe(id);
    expect(copie.nom).toBe('Villa Dupont (copie)');
    expect(useEtat.getState().projets).toHaveLength(2);
    expect(await persistance.listerProjets()).toHaveLength(2);

    const photosCopie = await persistance.listerPhotos(copie.id);
    expect(photosCopie).toHaveLength(1);
    expect(photosCopie[0].id).not.toBe('ph-1');
    expect(photosCopie[0].projetId).toBe(copie.id);
    // Le niveau et la pièce gardent leurs identifiants à l'intérieur du chantier copié.
    expect(photosCopie[0].niveauId).toBe(copie.niveaux[0].id);
    const images = await persistance.lireImages(photosCopie[0].id);
    expect(await contenu(images!.complete)).toEqual(Array.from(octets(50_000)));

    // L'original est intact.
    expect(await persistance.listerPhotos(id)).toHaveLength(1);
    expect((await persistance.lireProjet(id))!.nom).toBe('Villa Dupont');

    // Une deuxième copie ne prend pas le même nom.
    const copie2 = await importerSauvegarde(s, 'copie');
    expect(copie2.nom).toBe('Villa Dupont (copie 2)');
  });

  it('remplace le chantier existant, photos comprises', async () => {
    const id = await chantierAvecPhoto();
    const s = await exporter(id);
    await useEtat.getState().ouvrirProjet(id);
    useEtat.getState().modifierProjet((p) => (p.nom = 'Nom modifié après l’export'));
    await useEtat.getState().ajouterPhoto(photo('ph-2', id, null), { complete: new Blob(['x']), vignette: new Blob(['y']) });

    await importerSauvegarde(s, 'remplacer');
    // Le chantier ouvert est fermé : l'ancienne version en mémoire n'écrasera pas l'import.
    expect(useEtat.getState().projet).toBeNull();
    await useEtat.getState().enregistrerMaintenant();
    expect((await persistance.lireProjet(id))!.nom).toBe('Villa Dupont');
    expect(useEtat.getState().projets.map((p) => p.nom)).toEqual(['Villa Dupont']);
    expect((await persistance.listerPhotos(id)).map((p) => p.id)).toEqual(['ph-1']);
    expect(await persistance.lireImages('ph-2')).toBeUndefined();
  });

  it('refuse l’import direct d’un chantier déjà présent', async () => {
    const id = await chantierAvecPhoto();
    const s = await exporter(id);
    await expect(importerSauvegarde(s, 'nouveau')).rejects.toThrow(/existe déjà/);
  });

  it('remappe le projetId des photos même s’il est incohérent dans le fichier', async () => {
    const id = await chantierAvecPhoto();
    const s = await exporter(id);
    s.photos[0].meta.projetId = 'autre';
    const { photos } = preparerImport(s, { copie: false });
    expect(photos[0].meta.projetId).toBe(id);
  });
});

describe('validation du fichier importé', () => {
  beforeEach(reinitialiser);

  async function sauvegardeValide(): Promise<Record<string, any>> {
    const id = await chantierAvecPhoto();
    return JSON.parse(await (await exporterChantier(id)).blob.text());
  }

  function erreur(fn: () => unknown): string {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurSauvegarde);
      return (e as Error).message;
    }
    throw new Error('aucune erreur levée');
  }

  it('signale un fichier illisible', () => {
    expect(erreur(() => lireSauvegarde('{ pas du json'))).toMatch(/^Fichier illisible/);
    expect(erreur(() => lireSauvegarde('[1, 2, 3]'))).toMatch(/^Fichier illisible/);
    expect(erreur(() => lireSauvegarde(''))).toMatch(/^Fichier illisible/);
  });

  it('signale un autre format', () => {
    expect(erreur(() => lireSauvegarde(JSON.stringify({ format: 'visuary', version: 1 })))).toMatch(
      /n’est pas une sauvegarde de chantier ABSE/,
    );
    expect(erreur(() => lireSauvegarde(JSON.stringify({ nom: 'Villa' })))).toMatch(/n’est pas une sauvegarde/);
  });

  it('signale une version future ou inconnue', async () => {
    const s = await sauvegardeValide();
    expect(erreur(() => validerSauvegarde({ ...s, version: 2 }))).toMatch(/version plus récente de l’appli \(format 2\)/);
    expect(erreur(() => validerSauvegarde({ ...s, version: '1' }))).toMatch(/Version de fichier inconnue/);
    expect(erreur(() => validerSauvegarde({ ...s, projet: { ...s.projet, version: 3 } }))).toMatch(/plus récente/);
  });

  it('accepte une marque d’ordre des octets en tête', async () => {
    const s = await sauvegardeValide();
    expect(lireSauvegarde('﻿' + JSON.stringify(s)).projet.nom).toBe('Villa Dupont');
  });

  it('indique la donnée abîmée', async () => {
    const s = await sauvegardeValide();
    const casse = structuredClone(s);
    casse.projet.niveaux[0].actuel.pieces[0].sommets.splice(1, 2);
    expect(erreur(() => validerSauvegarde(casse))).toBe(
      'Fichier incomplet ou abîmé : donnée invalide (projet.niveaux[0].actuel.pieces[0].sommets).',
    );

    const sansNiveau = structuredClone(s);
    sansNiveau.projet.niveaux = [];
    expect(erreur(() => validerSauvegarde(sansNiveau))).toMatch(/projet\.niveaux : aucun niveau/);

    const cote = structuredClone(s);
    cote.projet.niveaux[0].actuel.pieces[0].sommets[0].x = 'douze';
    expect(erreur(() => validerSauvegarde(cote))).toMatch(/sommets\[0\]\.x/);

    const couleur = structuredClone(s);
    couleur.projet.catalogue.revetementsSol[0].couleur = 'rouge';
    expect(erreur(() => validerSauvegarde(couleur))).toMatch(/revetementsSol\[0\]\.couleur/);

    const doublon = structuredClone(s);
    doublon.photos.push(structuredClone(doublon.photos[0]));
    expect(erreur(() => validerSauvegarde(doublon))).toMatch(/photos : identifiants en double/);

    const image = structuredClone(s);
    image.photos[0].vignette = 'vignette.jpg';
    expect(erreur(() => validerSauvegarde(image))).toMatch(/photos\[0\]\.vignette/);

    const sansPhotos = structuredClone(s);
    delete sansPhotos.photos;
    expect(erreur(() => validerSauvegarde(sansPhotos))).toMatch(/\(photos\)/);
  });

  it('refuse une image abîmée avant d’écrire quoi que ce soit', async () => {
    const s = await sauvegardeValide();
    s.photos[0].complete = 'data:image/jpeg;base64,***';
    const valide = validerSauvegarde(s);
    await expect(importerSauvegarde(valide, 'copie')).rejects.toThrow(/image n’est pas lisible/);
    expect(await persistance.listerProjets()).toHaveLength(1);
  });

  it('garde les champs facultatifs inconnus (évolutions du modèle)', async () => {
    const s = await sauvegardeValide();
    s.projet.niveaux[0].actuel.pieces[0].nouveauChamp = 'conservé';
    const valide = validerSauvegarde(s);
    expect((valide.projet.niveaux[0].actuel.pieces[0] as unknown as Record<string, unknown>).nouveauChamp).toBe('conservé');
  });
});
