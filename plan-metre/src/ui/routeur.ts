// Navigation par l'ancre de l'URL (#/...), compatible GitHub Pages et hors ligne.
//
//   #/                              accueil (liste des chantiers)
//   #/chantier/<id>                 plan du chantier
//   #/chantier/<id>/releve          ajout de pièces (réalité augmentée, mètre laser, rectangle)
//   #/chantier/<id>/metre           métré
//   #/chantier/<id>/photos          photos du chantier
//   #/chantier/<id>/parametres      réglages du chantier

import { useSyncExternalStore } from 'react';
import { prendreEntreesCouches } from './commun/retour';

export type Route =
  | { ecran: 'accueil' }
  | { ecran: 'chantier'; id: string }
  | { ecran: 'releve'; id: string }
  | { ecran: 'metre'; id: string }
  | { ecran: 'photos'; id: string }
  | { ecran: 'parametres'; id: string };

export function analyserRoute(hash: string): Route {
  const morceaux = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (morceaux[0] === 'chantier' && morceaux[1]) {
    const id = morceaux[1];
    switch (morceaux[2]) {
      case 'releve':
      case 'metre':
      case 'photos':
      case 'parametres':
        return { ecran: morceaux[2], id };
      default:
        return { ecran: 'chantier', id };
    }
  }
  return { ecran: 'accueil' };
}

export function cheminRoute(r: Route): string {
  if (r.ecran === 'accueil') return '#/';
  const base = `#/chantier/${encodeURIComponent(r.id)}`;
  return r.ecran === 'chantier' ? base : `${base}/${r.ecran}`;
}

interface EtatHistorique {
  /** Adresse de l'écran d'où l'on vient (pour revenir() par l'historique). */
  abseDepuis?: string;
}

function normaliser(hash: string): string {
  return cheminRoute(analyserRoute(hash));
}

export function naviguer(r: Route, options: { remplacer?: boolean } = {}): void {
  const cible = cheminRoute(r);
  if (options.remplacer) {
    const depuis = (history.state as EtatHistorique | null)?.abseDepuis;
    history.replaceState(depuis === undefined ? null : { abseDepuis: depuis }, '', cible);
  } else {
    const etat = { abseDepuis: normaliser(window.location.hash) };
    // L'entrée d'une feuille ou d'un menu qu'on quitte en changeant d'écran
    // est réutilisée : sinon le retour retomberait sur une entrée fantôme.
    if (prendreEntreesCouches() > 0) history.replaceState(etat, '', cible);
    else history.pushState(etat, '', cible);
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * Retour vers `r` (flèche « retour » d'un écran) : on remonte l'historique
 * si l'on vient de `r`, sinon on remplace l'écran courant. Le bouton retour
 * d'Android ne repasse ainsi pas par les écrans déjà quittés.
 */
export function revenir(r: Route): void {
  const restes = prendreEntreesCouches();
  const depuis = (history.state as EtatHistorique | null)?.abseDepuis;
  if (depuis !== undefined && depuis === cheminRoute(r)) history.go(-(1 + restes));
  else naviguer(r, { remplacer: true });
}

function abonner(rappel: () => void) {
  window.addEventListener('hashchange', rappel);
  return () => window.removeEventListener('hashchange', rappel);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(abonner, () => window.location.hash);
  return analyserRoute(hash);
}
