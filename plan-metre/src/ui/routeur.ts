// Navigation par l'ancre de l'URL (#/...), compatible GitHub Pages et hors ligne.
//
//   #/                              accueil (liste des chantiers)
//   #/chantier/<id>                 plan du chantier
//   #/chantier/<id>/releve          ajout de pièces (réalité augmentée, mètre laser, rectangle)
//   #/chantier/<id>/metre           métré
//   #/chantier/<id>/photos          photos du chantier
//   #/chantier/<id>/parametres      réglages du chantier

import { useSyncExternalStore } from 'react';

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

export function naviguer(r: Route, options: { remplacer?: boolean } = {}): void {
  const cible = cheminRoute(r);
  if (options.remplacer) {
    history.replaceState(null, '', cible);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = cible;
  }
}

function abonner(rappel: () => void) {
  window.addEventListener('hashchange', rappel);
  return () => window.removeEventListener('hashchange', rappel);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(abonner, () => window.location.hash);
  return analyserRoute(hash);
}
