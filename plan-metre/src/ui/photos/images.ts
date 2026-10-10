// Accès aux images des photos depuis l'interface : URL d'affichage libérées
// automatiquement, modifications enchaînées, partage et téléchargement.

import { useEffect, useState } from 'react';
import type { ID, Photo } from '../../model/types';
import { useEtat } from '../../store/etat';
import { urlImage } from '../../store/images';
import * as persistance from '../../store/persistance';
import { telechargerFichier } from '../../store/sauvegarde';
import { notifier } from '../commun/dialogues';
import { nomFichierPhoto } from './presentation';

/**
 * URL d'affichage (blob:) d'une image stockée, libérée au démontage ou au
 * changement de photo. null tant qu'elle se charge ou si l'image manque.
 */
export function useUrlImage(id: ID | null, taille: 'complete' | 'vignette'): string | null {
  const [etat, setEtat] = useState<{ id: ID; taille: string; url: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let actif = true;
    let url: string | null = null;
    urlImage(id, taille)
      .then((u) => {
        if (!u) return;
        if (actif) {
          url = u;
          setEtat({ id, taille, url: u });
        } else {
          URL.revokeObjectURL(u);
        }
      })
      .catch((e) => console.error('Image illisible', e));
    return () => {
      actif = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, taille]);
  return etat && etat.id === id && etat.taille === taille ? etat.url : null;
}

let file: Promise<void> = Promise.resolve();

/**
 * Modifie une photo après les modifications précédentes : deux changements
 * rapprochés (légende puis niveau) ne s'écrasent pas l'un l'autre. Un échec
 * est signalé à l'utilisateur ; la promesse rendue ne rejette jamais.
 */
export function modifierPhotoEnSerie(id: ID, changements: Partial<Omit<Photo, 'id' | 'projetId'>>): Promise<void> {
  file = file
    .then(() => useEtat.getState().modifierPhoto(id, changements))
    .catch((e) => {
      console.error('Photo non enregistrée', e);
      notifier('La modification de la photo n’a pas pu être enregistrée.', { erreur: true });
    });
  return file;
}

/** Attend la fin des modifications en cours (avant suppression, par exemple). */
export function attendreModifications(): Promise<void> {
  return file;
}

function estAnnulation(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError';
}

/** Partage la photo (mail, WhatsApp…) ou, à défaut, la télécharge. */
export async function partagerOuTelechargerPhoto(photo: Photo, nomChantier: string): Promise<void> {
  const images = await persistance.lireImages(photo.id);
  if (!images) {
    notifier('Image introuvable sur l’appareil.', { erreur: true });
    return;
  }
  const nom = nomFichierPhoto(nomChantier, photo);
  const fichier = new File([images.complete], nom, { type: images.complete.type || 'image/jpeg' });
  let partageable = false;
  try {
    partageable = typeof navigator.share === 'function' && navigator.canShare?.({ files: [fichier] }) === true;
  } catch {
    partageable = false;
  }
  if (!partageable) {
    telechargerFichier(images.complete, nom);
    notifier(`Photo enregistrée dans les téléchargements (${nom})`);
    return;
  }
  try {
    await navigator.share({ files: [fichier], title: photo.legende.trim() || `Photo du chantier ${nomChantier}` });
  } catch (e) {
    if (estAnnulation(e)) return;
    console.warn('Partage refusé', e);
    telechargerFichier(images.complete, nom);
    notifier('Partage refusé par l’appareil : la photo a été téléchargée à la place.');
  }
}
