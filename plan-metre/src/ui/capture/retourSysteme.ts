// Bouton « retour » du téléphone (ou du navigateur) pendant le relevé.
//
// Une entrée d'historique « garde », à la même adresse, est posée au-dessus
// du relevé. Le retour système la consomme : on la repose aussitôt et l'on
// exécute l'action de la flèche de l'écran affiché (étape précédente,
// confirmation avant de perdre des mesures). Pour sortir du relevé par ce
// retour, `quitterParRetour` remonte réellement l'historique.
//
// Une entrée posée au-dessus de la garde (feuille, dialogue…) se ferme par
// le retour sans que le relevé ne réagisse : l'entrée courante est alors
// encore la garde.

import { useEffect, useRef } from 'react';

const CLE = 'abseReleve';

function estGarde(etat: unknown): boolean {
  return typeof etat === 'object' && etat !== null && (etat as Record<string, unknown>)[CLE] === true;
}

function poserGarde() {
  history.pushState({ [CLE]: true }, '');
}

/**
 * Tant que `surRetour` n'est pas null, le retour système l'appelle (même
 * action que la flèche de l'écran affiché).
 */
export function useRetourSysteme(surRetour: (() => void) | null): void {
  const rappel = useRef(surRetour);
  useEffect(() => {
    rappel.current = surRetour;
  });
  const actif = surRetour !== null;
  useEffect(() => {
    if (!actif) return;
    const adresse = location.hash;
    if (!estGarde(history.state)) poserGarde();
    const surPop = () => {
      // Entrée au-dessus de la garde refermée, ou navigation vers un autre écran : pas pour le relevé.
      if (estGarde(history.state) || location.hash !== adresse) return;
      poserGarde();
      rappel.current?.();
    };
    window.addEventListener('popstate', surPop);
    return () => window.removeEventListener('popstate', surPop);
  }, [actif]);
}

/**
 * Sort du relevé par l'historique, comme le retour système l'aurait fait
 * sans la garde. `repli` sert quand rien ne précède le relevé (adresse
 * ouverte directement).
 */
export function quitterParRetour(repli: () => void): void {
  const pas = estGarde(history.state) ? 2 : 1;
  const navigation = (window as { navigation?: { currentEntry?: { index: number } | null } }).navigation;
  const index = navigation?.currentEntry?.index;
  if (index !== undefined && index < pas) repli();
  else history.go(-pas);
}
