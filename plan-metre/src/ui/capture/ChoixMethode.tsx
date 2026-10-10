// Choix de la méthode de relevé : réalité augmentée (si le téléphone le
// permet), mètre laser, pièce rectangulaire.

import { useId, type ReactNode } from 'react';
import { Icone } from '../commun/Icone';
import { IconeReleve } from './IconeReleve';
import type { DisponibiliteRA } from './sessionRA';
import type { MethodeReleve } from './zones';

export type EtatDisponibiliteRA = DisponibiliteRA | 'verification';

function raisonIndisponibilite(d: EtatDisponibiliteRA): string {
  switch (d) {
    case 'verification':
      return 'Vérification de la compatibilité du téléphone…';
    case 'non-securise':
      return 'L’appli n’est pas ouverte en https : la caméra en réalité augmentée est bloquée.';
    case 'sans-webxr':
      return 'Ce navigateur ne gère pas la réalité augmentée (WebXR).';
    default:
      return 'Ce téléphone ou ce navigateur ne permet pas la réalité augmentée.';
  }
}

function Carte({
  icone,
  titre,
  detail,
  desactivee,
  onClick,
  children,
}: {
  icone: ReactNode;
  titre: string;
  detail: string;
  desactivee?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <button
      type="button"
      className="releve-carte"
      aria-labelledby={`${id}-titre`}
      aria-describedby={`${id}-detail`}
      aria-disabled={desactivee || undefined}
      onClick={() => {
        if (!desactivee) onClick();
      }}
    >
      <span className="releve-carte-icone">{icone}</span>
      <span className="releve-carte-texte">
        <span className="releve-carte-titre" id={`${id}-titre`}>
          {titre}
        </span>
        <span id={`${id}-detail`}>
          <span className="releve-carte-detail">{detail}</span>
          {children}
        </span>
      </span>
      {!desactivee && (
        <span className="releve-carte-suivant">
          <Icone nom="suivant" taille={20} />
        </span>
      )}
    </button>
  );
}

export function ChoixMethode({
  disponibiliteRA,
  onChoisir,
}: {
  disponibiliteRA: EtatDisponibiliteRA;
  onChoisir: (m: MethodeReleve) => void;
}) {
  const raDisponible = disponibiliteRA === 'disponible';
  return (
    <div className="releve-cartes">
      <Carte
        icone={<IconeReleve nom="realite-augmentee" taille={28} />}
        titre="Réalité augmentée"
        detail="Visez chaque angle au pied des murs avec la caméra, puis la jonction mur / plafond."
        desactivee={!raDisponible}
        onClick={() => onChoisir('ra')}
      >
        {!raDisponible && (
          <span className="releve-carte-raison">
            <strong>{raisonIndisponibilite(disponibiliteRA)}</strong>
            {disponibiliteRA !== 'verification' && (
              <>
                {' '}Il faut :
                <span className="releve-carte-liste">
                  <span>un téléphone Android compatible ARCore ;</span>
                  <span>le navigateur Chrome à jour ;</span>
                  <span>l’appli ouverte en https (adresse publiée) ;</span>
                  <span>l’appli « Services Google Play pour la RA » installée (Play Store).</span>
                </span>
                Le mètre laser et la pièce rectangulaire restent disponibles.
              </>
            )}
          </span>
        )}
      </Carte>
      <Carte
        icone={<Icone nom="laser" taille={28} />}
        titre="Mètre laser"
        detail="Faites le tour de la pièce : saisissez chaque côté, puis le sens du virage."
        onClick={() => onChoisir('laser')}
      />
      <Carte
        icone={<Icone nom="rectangle" taille={28} />}
        titre="Pièce rectangulaire"
        detail="Longueur × largeur × hauteur."
        onClick={() => onChoisir('rectangle')}
      />
    </div>
  );
}
