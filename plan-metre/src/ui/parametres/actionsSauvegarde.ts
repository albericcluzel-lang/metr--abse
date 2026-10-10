// Export d'un chantier vers un fichier, partagé par l'accueil et les réglages :
// téléchargement (dossier Téléchargements) ou partage (mail, WhatsApp, Drive…).

import {
  ErreurSauvegarde,
  exporterChantier,
  fichiersPartageables,
  partageFichiersDisponible,
  telechargerFichier,
  type ExportChantier,
} from '../../store/sauvegarde';
import type { ID } from '../../model/types';
import { confirmer, notifier } from '../commun/dialogues';

export { partageFichiersDisponible };

/** Un seul export à la fois (double appui, gros chantier avec photos). */
let enCours = false;

function messageErreur(e: unknown): string {
  return e instanceof ErreurSauvegarde ? e.message : 'Export impossible : le fichier n’a pas pu être préparé.';
}

function avertissementPhotos(e: ExportChantier): string {
  if (e.photosManquantes === 0) return '';
  return e.photosManquantes === 1
    ? ' (1 photo introuvable sur l’appareil n’a pas été incluse)'
    : ` (${e.photosManquantes} photos introuvables sur l’appareil n’ont pas été incluses)`;
}

async function preparer(id: ID): Promise<ExportChantier | null> {
  if (enCours) return null;
  enCours = true;
  try {
    notifier('Préparation du fichier…');
    return await exporterChantier(id);
  } catch (e) {
    console.error('Export impossible', e);
    notifier(messageErreur(e), { erreur: true });
    return null;
  } finally {
    enCours = false;
  }
}

function telecharger(e: ExportChantier, prefixe = '') {
  telechargerFichier(e.blob, e.nomFichier);
  notifier(`${prefixe}Fichier « ${e.nomFichier} » enregistré dans les téléchargements${avertissementPhotos(e)}`);
}

/** Exporte le chantier et télécharge le fichier de sauvegarde. */
export async function telechargerChantier(id: ID): Promise<void> {
  const e = await preparer(id);
  if (e) telecharger(e);
}

function estAnnulation(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError';
}

/** Exporte le chantier et ouvre le partage du téléphone (repli : téléchargement). */
export async function partagerChantier(id: ID): Promise<void> {
  const e = await preparer(id);
  if (!e) return;
  const fichiers = fichiersPartageables(e.blob, e.nomFichier);
  if (fichiers.length === 0 || typeof navigator.share !== 'function') {
    telecharger(e, 'Partage indisponible sur cet appareil. ');
    return;
  }
  const donnees = (f: File): ShareData => ({
    files: [f],
    title: `Chantier ${e.nomChantier}`,
    text: `Sauvegarde du chantier « ${e.nomChantier} » (ABSE Plan & Métré). Pour l’ouvrir : appli ABSE Plan & Métré → Importer un chantier.`,
  });
  try {
    await navigator.share(donnees(fichiers[0]));
    return;
  } catch (err) {
    if (estAnnulation(err)) return;
    console.warn('Partage refusé', err);
  }
  // Préparation trop longue (le geste de l'utilisateur a expiré) ou type de fichier refusé :
  // on redemande un appui, et on se rabat sur la version texte du fichier.
  const ok = await confirmer({
    titre: 'Fichier prêt à partager',
    message: `« ${e.nomFichier} » est prêt. Touchez « Partager » pour choisir l’application (mail, WhatsApp, Drive…).`,
    libelleConfirmer: 'Partager',
  });
  if (!ok) return;
  try {
    await navigator.share(donnees(fichiers[fichiers.length - 1]));
  } catch (err) {
    if (estAnnulation(err)) return;
    console.warn('Partage refusé', err);
    telecharger(e, 'Partage refusé par l’appareil. ');
  }
}
