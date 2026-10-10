// Champs propres aux réglages : texte obligatoire (jamais enregistré vide) et
// saisies compactes pour les lignes du catalogue (libellé lu par les lecteurs d'écran).

import { useEffect, useId, useState } from 'react';
import type { Projet } from '../../model/types';
import { useEtat } from '../../store/etat';
import { Champ, ecrireNombre, lireNombre } from '../commun/composants';

// Regroupement de la frappe : chaque champ touché ouvre une « session » ; les
// modifications d'un même champ pendant la même session forment une seule
// étape d'annulation (cf. modifierProjet et son option `cle`).
let session = 0;

/** À appeler quand le focus change de champ (écouteur onFocus de l'écran). */
export function nouvelleSessionSaisie(): void {
  session++;
}

/** Modifie le chantier ouvert ; `champ` regroupe la frappe continue dans ce champ. */
export function modifierChantier(fn: (p: Projet) => void, champ?: string): void {
  useEtat.getState().modifierProjet(fn, champ ? { cle: `reglages:${champ}:${session}` } : undefined);
}

/**
 * Texte qui ne peut pas rester vide : la saisie vide n'est pas enregistrée
 * (le dernier nom valable est gardé) et un message l'explique.
 */
export function TexteObligatoire({
  libelle,
  valeur,
  onChange,
  compact,
  placeholder,
  autoFocus,
  messageVide = 'Ce nom ne peut pas rester vide.',
}: {
  libelle: string;
  valeur: string;
  onChange: (v: string) => void;
  /** Sans libellé visible (lignes de liste). */
  compact?: boolean;
  placeholder?: string;
  /** Focus et texte sélectionné à l'apparition (élément qui vient d'être ajouté). */
  autoFocus?: boolean;
  messageVide?: string;
}) {
  const id = useId();
  const [texte, setTexte] = useState(valeur);
  const [edition, setEdition] = useState(false);
  useEffect(() => {
    if (!edition) setTexte(valeur);
  }, [valeur, edition]);
  const vide = texte.trim() === '';

  const saisie = (
    <div className={`saisie${vide ? ' invalide' : ''}${compact ? ' reglages-saisie-compacte' : ''}`}>
      <input
        id={id}
        value={texte}
        placeholder={placeholder}
        aria-label={compact ? libelle : undefined}
        aria-invalid={vide || undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        onFocus={(e) => {
          setEdition(true);
          if (autoFocus) e.currentTarget.select();
        }}
        onBlur={() => {
          setEdition(false);
          const propre = texte.trim();
          if (propre === '') setTexte(valeur);
          else if (propre !== texte) onChange(propre);
        }}
        onChange={(e) => {
          setTexte(e.target.value);
          if (e.target.value.trim() !== '') onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </div>
  );
  if (compact) {
    return (
      <div className="reglages-compact">
        {saisie}
        {vide && <span className="reglages-erreur">{messageVide}</span>}
      </div>
    );
  }
  return (
    <div className={vide ? 'reglages-champ-erreur' : undefined}>
      <Champ libelle={libelle} htmlFor={id} aide={vide ? messageVide : undefined}>
        {saisie}
      </Champ>
    </div>
  );
}

/** Nombre compact (virgule acceptée), validé à la sortie du champ ou sur Entrée. */
export function NombreCompact({
  libelle,
  valeur,
  onChange,
  unite,
  min,
  max,
  decimales = 1,
}: {
  libelle: string;
  valeur: number;
  onChange: (v: number) => void;
  unite?: string;
  min?: number;
  max?: number;
  decimales?: number;
}) {
  const [texte, setTexte] = useState(() => ecrireNombre(valeur, decimales));
  const [edition, setEdition] = useState(false);
  useEffect(() => {
    if (!edition) setTexte(ecrireNombre(valeur, decimales));
  }, [valeur, decimales, edition]);
  const n = lireNombre(texte);
  const invalide = Number.isNaN(n) || (min !== undefined && n < min) || (max !== undefined && n > max);
  const valider = () => {
    setEdition(false);
    if (!invalide && n !== valeur) onChange(n);
    else setTexte(ecrireNombre(valeur, decimales));
  };
  return (
    <div className={`saisie reglages-saisie-compacte reglages-nombre${invalide ? ' invalide' : ''}`}>
      <input
        aria-label={libelle}
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        value={texte}
        aria-invalid={invalide || undefined}
        onFocus={(e) => {
          setEdition(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setTexte(e.target.value)}
        onBlur={valider}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {unite && <span className="saisie-unite">{unite}</span>}
    </div>
  );
}
