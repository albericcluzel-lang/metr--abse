// Préparation des photos : redimensionnement (les photos de téléphone font
// souvent 4000 px et plusieurs Mo), compression JPEG et vignette.

import { maintenantIso, nouvelId } from '../model/fabrique';
import type { ID, Photo, Point } from '../model/types';
import { useEtat } from './etat';
import type { ImagesPhoto } from './persistance';

const COTE_MAX = 2000;
const COTE_VIGNETTE = 360;

async function versCanvas(source: ImageBitmap, coteMax: number): Promise<Blob> {
  const echelle = Math.min(1, coteMax / Math.max(source.width, source.height));
  const l = Math.max(1, Math.round(source.width * echelle));
  const h = Math.max(1, Math.round(source.height * echelle));
  const canvas = document.createElement('canvas');
  canvas.width = l;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.drawImage(source, 0, 0, l, h);
  return new Promise((resoudre, rejeter) =>
    canvas.toBlob((b) => (b ? resoudre(b) : rejeter(new Error('Compression impossible'))), 'image/jpeg', 0.85),
  );
}

export async function preparerImage(fichier: Blob): Promise<ImagesPhoto & { largeur: number; hauteur: number }> {
  // imageOrientation : applique la rotation EXIF des photos prises en portrait.
  const bitmap = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
  try {
    const complete = await versCanvas(bitmap, COTE_MAX);
    const vignette = await versCanvas(bitmap, COTE_VIGNETTE);
    const echelle = Math.min(1, COTE_MAX / Math.max(bitmap.width, bitmap.height));
    return {
      complete,
      vignette,
      largeur: Math.round(bitmap.width * echelle),
      hauteur: Math.round(bitmap.height * echelle),
    };
  } finally {
    bitmap.close();
  }
}

export interface ContextePhoto {
  niveauId?: ID | null;
  pieceId?: ID | null;
  position?: Point | null;
  legende?: string;
}

/** Prépare l'image et l'ajoute aux photos du chantier ouvert. */
export async function ajouterPhotoDepuisFichier(fichier: Blob, contexte: ContextePhoto = {}): Promise<Photo> {
  const projet = useEtat.getState().projet;
  if (!projet) throw new Error('Aucun chantier ouvert');
  const images = await preparerImage(fichier);
  const date =
    fichier instanceof File && fichier.lastModified ? new Date(fichier.lastModified).toISOString() : maintenantIso();
  const photo: Photo = {
    id: nouvelId(),
    projetId: projet.id,
    niveauId: contexte.niveauId ?? null,
    pieceId: contexte.pieceId ?? null,
    position: contexte.position ?? null,
    legende: contexte.legende ?? '',
    date,
    largeur: images.largeur,
    hauteur: images.hauteur,
  };
  await useEtat.getState().ajouterPhoto(photo, { complete: images.complete, vignette: images.vignette });
  return photo;
}

/** URL d'affichage d'une image stockée (à libérer avec URL.revokeObjectURL). */
export async function urlImage(id: ID, taille: 'complete' | 'vignette'): Promise<string | null> {
  const { lireImages } = await import('./persistance');
  const images = await lireImages(id);
  const blob = images?.[taille];
  return blob ? URL.createObjectURL(blob) : null;
}
