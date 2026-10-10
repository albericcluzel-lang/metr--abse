// Feuille « Nouvelle pièce » ouverte à la fermeture d'un tracé : nom et
// hauteur sous plafond.

import { useEffect, useRef, useState } from 'react';
import { aire, perimetre } from '../../geometrie/polygone';
import { formaterValeur } from '../../metre/calcul';
import { NOMS_PIECES } from '../../model/catalogue';
import type { Point } from '../../model/types';
import { Bouton, ChampNombre, ChampTexte, FeuilleBas } from '../commun/composants';

const ID_FORMULAIRE = 'plan2d-nouvelle-piece';

export function FormulaireNouvellePiece({
  ouvert,
  points,
  hauteurDefaut,
  nomParDefaut,
  onAnnuler,
  onCreer,
}: {
  ouvert: boolean;
  points: readonly Point[];
  hauteurDefaut: number;
  /** Nom retenu si le champ reste vide. */
  nomParDefaut: string;
  onAnnuler: () => void;
  onCreer: (nom: string, hauteur: number) => void;
}) {
  const [nom, setNom] = useState('');
  const [hauteur, setHauteur] = useState(hauteurDefaut);
  // La validation par Entrée arrive avant le rendu qui suit la saisie de la hauteur.
  const hauteurRef = useRef(hauteurDefaut);
  useEffect(() => {
    if (!ouvert) return;
    setNom('');
    setHauteur(hauteurDefaut);
    hauteurRef.current = hauteurDefaut;
  }, [ouvert, hauteurDefaut]);

  return (
    <FeuilleBas
      ouverte={ouvert}
      titre="Nouvelle pièce"
      onFermer={onAnnuler}
      pied={
        <>
          <Bouton variante="contour" onClick={onAnnuler}>
            Reprendre le tracé
          </Bouton>
          <Bouton type="submit" form={ID_FORMULAIRE} icone="valider">
            Créer la pièce
          </Bouton>
        </>
      }
    >
      <form
        id={ID_FORMULAIRE}
        onSubmit={(e) => {
          e.preventDefault();
          onCreer(nom.trim() || nomParDefaut, hauteurRef.current);
        }}
      >
        <ChampTexte
          libelle="Nom de la pièce"
          valeur={nom}
          onChange={setNom}
          suggestions={NOMS_PIECES}
          placeholder={nomParDefaut}
          autoFocus
        />
        <ChampNombre
          libelle="Hauteur sous plafond"
          valeur={hauteur}
          onChange={(v) => {
            hauteurRef.current = v;
            setHauteur(v);
          }}
          unite="cm"
          min={50}
          max={1000}
          decimales={1}
        />
        <p className="plan2d-rappel">
          Surface <strong>{formaterValeur(aire(points) / 1e4, 'm²')}</strong> · Périmètre{' '}
          <strong>{formaterValeur(perimetre(points) / 100, 'm')}</strong>
        </p>
      </form>
    </FeuilleBas>
  );
}
