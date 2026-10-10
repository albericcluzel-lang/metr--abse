// Installation de l'appli (PWA) sur l'écran d'accueil du téléphone ou du PC.
//
// Chrome n'envoie « beforeinstallprompt » qu'une fois, souvent avant que
// l'accueil ne s'affiche : l'événement est mémorisé dès le chargement de ce
// module (importé au démarrage par App), pour proposer le bouton à tout moment.

import { useSyncExternalStore } from 'react';

interface EvenementInstallation extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

/** installee : l'appli tourne déjà en mode installé ; proposable : Chrome accepte d'installer ; aide : marche à suivre manuelle. */
export type EtatInstallation = 'installee' | 'proposable' | 'aide';

let evenementDiffere: EvenementInstallation | null = null;
let installeeALInstant = false;
const abonnes = new Set<() => void>();

function prevenir() {
  for (const rappel of abonnes) rappel();
}

function requeteAutonome(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)')
    : null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Remplace le bandeau automatique de Chrome par notre bouton.
    e.preventDefault();
    evenementDiffere = e as EvenementInstallation;
    prevenir();
  });
  window.addEventListener('appinstalled', () => {
    evenementDiffere = null;
    installeeALInstant = true;
    prevenir();
  });
}

function etatActuel(): EtatInstallation {
  const ios = typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (installeeALInstant || ios || requeteAutonome()?.matches) return 'installee';
  return evenementDiffere ? 'proposable' : 'aide';
}

function abonner(rappel: () => void): () => void {
  abonnes.add(rappel);
  const requete = requeteAutonome();
  requete?.addEventListener('change', rappel);
  return () => {
    abonnes.delete(rappel);
    requete?.removeEventListener('change', rappel);
  };
}

export function useInstallation(): EtatInstallation {
  return useSyncExternalStore(abonner, etatActuel, () => 'aide');
}

/** Ouvre la fenêtre d'installation de Chrome ; true si l'utilisateur accepte. */
export async function lancerInstallation(): Promise<boolean> {
  const e = evenementDiffere;
  if (!e) return false;
  // L'événement ne sert qu'une fois : Chrome en renverra un s'il le juge utile.
  evenementDiffere = null;
  try {
    await e.prompt();
    const choix = await e.userChoice;
    return choix.outcome === 'accepted';
  } finally {
    prevenir();
  }
}
