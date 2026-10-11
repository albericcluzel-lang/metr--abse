// Bouton « retour » d'Android (et du navigateur) : il ferme d'abord la
// feuille, le menu ou la visionneuse ouverts, au lieu de quitter l'écran.
//
// Chaque couche ouverte ajoute une entrée d'historique à la même adresse,
// marquée de sa profondeur. Un retour ramène à une profondeur inférieure :
// les couches au-dessus se ferment. Une couche fermée autrement (bouton,
// Échap) retire son entrée elle-même.

import { useEffect, useRef } from 'react';

interface Couche {
  fermer: () => void;
}

const pile: Couche[] = [];
/** Retrait différé de l'entrée d'une couche fermée par un bouton (cf. useRetourSysteme). */
let retraitPrevu: ReturnType<typeof setTimeout> | null = null;
/** Retours d'historique lancés par nous-mêmes (retrait d'entrée), pas par l'utilisateur. */
let retoursInternes = 0;

function profondeurDeLEtat(etat: unknown): number {
  const p = (etat as { abseCouche?: unknown } | null)?.abseCouche;
  return typeof p === 'number' ? p : 0;
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    const p = profondeurDeLEtat(e.state);
    if (retoursInternes > 0) {
      // Notre propre retrait d'entrée : rien à fermer. Si une couche s'est
      // ouverte entre-temps, ce retour a emporté son entrée : on la lui rend.
      retoursInternes--;
      for (let d = p + 1; d <= pile.length; d++) {
        history.pushState({ ...(history.state as object | null), abseCouche: d }, '');
      }
      return;
    }
    while (pile.length > p) pile.pop()!.fermer();
  });
}

/** Tant que `ouvert` est vrai, le retour système appelle `fermer` au lieu de quitter l'écran. */
export function useRetourSysteme(ouvert: boolean, fermer: () => void): void {
  const rappel = useRef(fermer);
  rappel.current = fermer;
  useEffect(() => {
    if (!ouvert) return;
    let fermeeParRetour = false;
    const couche: Couche = {
      fermer: () => {
        fermeeParRetour = true;
        rappel.current();
      },
    };
    pile.push(couche);
    const profondeur = pile.length;
    if (retraitPrevu !== null && profondeurDeLEtat(history.state) === profondeur) {
      // Une couche vient de se fermer à cette profondeur (une feuille en
      // remplace une autre) : on reprend son entrée au lieu d'en empiler une.
      clearTimeout(retraitPrevu);
      retraitPrevu = null;
    } else {
      history.pushState({ ...(history.state as object | null), abseCouche: profondeur }, '');
    }
    return () => {
      const i = pile.indexOf(couche);
      if (i >= 0) pile.splice(i, 1);
      if (fermeeParRetour || profondeurDeLEtat(history.state) !== profondeur) return;
      // Fermée par un bouton : on retire l'entrée ajoutée, un peu plus tard pour
      // laisser une autre couche la reprendre, et pas si l'on a changé d'écran
      // entre-temps (l'entrée courante n'est alors plus la nôtre).
      if (retraitPrevu !== null) clearTimeout(retraitPrevu);
      retraitPrevu = setTimeout(() => {
        retraitPrevu = null;
        if (pile.length < profondeur && profondeurDeLEtat(history.state) === profondeur) {
          retoursInternes++;
          history.back();
        }
      }, 0);
    };
  }, [ouvert]);
}

/**
 * Pour la navigation entre écrans : nombre d'entrées d'historique laissées
 * au-dessus de l'écran courant par des couches déjà fermées (retrait en
 * attente, ou couche démontée en changeant d'écran). Le retrait prévu est
 * annulé : l'appelant consomme ces entrées lui-même.
 */
export function prendreEntreesCouches(): number {
  if (retraitPrevu !== null) {
    clearTimeout(retraitPrevu);
    retraitPrevu = null;
  }
  return Math.max(0, profondeurDeLEtat(history.state) - pile.length);
}
