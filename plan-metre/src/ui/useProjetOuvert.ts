import { useEffect, useState } from 'react';
import type { Projet } from '../model/types';
import { useEtat } from '../store/etat';
import { naviguer } from './routeur';

/**
 * Ouvre le chantier `id` (s'il ne l'est pas déjà) et le renvoie ; null tant
 * qu'il se charge. Redirige vers l'accueil si le chantier n'existe pas.
 */
export function useProjetOuvert(id: string): Projet | null {
  const pret = useEtat((e) => e.pret);
  const projet = useEtat((e) => (e.projet?.id === id ? e.projet : null));
  const [introuvable, setIntrouvable] = useState(false);
  useEffect(() => {
    if (!pret) return;
    let actif = true;
    void useEtat
      .getState()
      .ouvrirProjet(id)
      .then((ok) => {
        if (actif && !ok) setIntrouvable(true);
      });
    return () => {
      actif = false;
    };
  }, [id, pret]);
  useEffect(() => {
    if (introuvable) naviguer({ ecran: 'accueil' }, { remplacer: true });
  }, [introuvable]);
  return projet;
}
