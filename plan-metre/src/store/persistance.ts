// Stockage local (IndexedDB) : chantiers, métadonnées des photos, images.
// Rien ne quitte l'appareil ; la sauvegarde / le transfert passent par
// l'export de fichier (cf. ui/parametres).

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ID, Photo, Projet } from '../model/types';

export interface ImagesPhoto {
  complete: Blob;
  vignette: Blob;
}

interface SchemaBase extends DBSchema {
  projets: { key: ID; value: Projet };
  photos: { key: ID; value: Photo; indexes: { parProjet: ID } };
  images: { key: ID; value: ImagesPhoto };
}

const NOM_BASE = 'abse-plan-metre';
let base: Promise<IDBPDatabase<SchemaBase>> | null = null;

function ouvrir(): Promise<IDBPDatabase<SchemaBase>> {
  if (!base) {
    base = openDB<SchemaBase>(NOM_BASE, 1, {
      upgrade(db) {
        db.createObjectStore('projets', { keyPath: 'id' });
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('parProjet', 'projetId');
        db.createObjectStore('images');
      },
    });
  }
  return base;
}

/** Pour les tests : ferme et oublie la connexion. */
export async function fermerBase(): Promise<void> {
  if (base) (await base).close();
  base = null;
}

export async function listerProjets(): Promise<Projet[]> {
  const db = await ouvrir();
  const tous = await db.getAll('projets');
  return tous.sort((a, b) => b.modifieLe.localeCompare(a.modifieLe));
}

export async function lireProjet(id: ID): Promise<Projet | undefined> {
  return (await ouvrir()).get('projets', id);
}

export async function enregistrerProjet(projet: Projet): Promise<void> {
  await (await ouvrir()).put('projets', projet);
}

/** Supprime le chantier et toutes ses photos. */
export async function supprimerProjet(id: ID): Promise<void> {
  const db = await ouvrir();
  const tx = db.transaction(['projets', 'photos', 'images'], 'readwrite');
  const ids = await tx.objectStore('photos').index('parProjet').getAllKeys(id);
  await Promise.all([
    tx.objectStore('projets').delete(id),
    ...ids.map((pid) => tx.objectStore('photos').delete(pid)),
    ...ids.map((pid) => tx.objectStore('images').delete(pid)),
  ]);
  await tx.done;
}

export async function listerPhotos(projetId: ID): Promise<Photo[]> {
  const db = await ouvrir();
  const photos = await db.getAllFromIndex('photos', 'parProjet', projetId);
  return photos.sort((a, b) => a.date.localeCompare(b.date));
}

export async function enregistrerPhoto(photo: Photo, images?: ImagesPhoto): Promise<void> {
  const db = await ouvrir();
  const tx = db.transaction(['photos', 'images'], 'readwrite');
  await tx.objectStore('photos').put(photo);
  if (images) await tx.objectStore('images').put(images, photo.id);
  await tx.done;
}

export async function supprimerPhoto(id: ID): Promise<void> {
  const db = await ouvrir();
  const tx = db.transaction(['photos', 'images'], 'readwrite');
  await Promise.all([tx.objectStore('photos').delete(id), tx.objectStore('images').delete(id)]);
  await tx.done;
}

export async function lireImages(id: ID): Promise<ImagesPhoto | undefined> {
  return (await ouvrir()).get('images', id);
}

/**
 * Demande au navigateur de ne pas effacer les données en cas de manque de
 * place (sinon Chrome peut vider le stockage d'un site peu utilisé).
 */
export async function demanderStockagePersistant(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
