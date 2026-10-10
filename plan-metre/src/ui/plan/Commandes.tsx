// Commandes flottantes de l'éditeur : palette d'outils (colonne à gauche),
// bandeaux d'aide et de choix du type, barre du tracé, état vide.

import type { ReactNode } from 'react';
import { Bouton, BoutonIcone } from '../commun/composants';
import { Icone, type NomIcone } from '../commun/Icone';

export type Outil = 'selection' | 'dessin' | 'ouverture' | 'equipement' | 'photo';

const OUTILS: { id: Outil; icone: NomIcone; libelle: string }[] = [
  { id: 'selection', icone: 'selection', libelle: 'Sélection' },
  { id: 'dessin', icone: 'crayon', libelle: 'Dessiner une pièce' },
  { id: 'ouverture', icone: 'porte', libelle: 'Ajouter une ouverture' },
  { id: 'equipement', icone: 'equipement', libelle: 'Ajouter un équipement' },
  { id: 'photo', icone: 'photo', libelle: 'Placer une photo' },
];

export function Palette({
  outil,
  onOutil,
  onZoomAvant,
  onZoomArriere,
  onAjuster,
}: {
  outil: Outil;
  onOutil: (o: Outil) => void;
  onZoomAvant: () => void;
  onZoomArriere: () => void;
  onAjuster: () => void;
}) {
  return (
    <div className="plan2d-palette">
      <div className="plan2d-groupe" role="toolbar" aria-orientation="vertical" aria-label="Outils du plan">
        {OUTILS.map((o) => (
          <BoutonIcone
            key={o.id}
            icone={o.icone}
            libelle={o.libelle}
            actif={outil === o.id}
            // Toucher l'outil actif revient à la sélection.
            onClick={() => onOutil(outil === o.id ? 'selection' : o.id)}
          />
        ))}
      </div>
      <div className="plan2d-groupe" role="group" aria-label="Vue">
        <BoutonIcone icone="plus" libelle="Zoom avant" onClick={onZoomAvant} />
        <BoutonIcone icone="moins" libelle="Zoom arrière" onClick={onZoomArriere} />
        <BoutonIcone icone="ajuster" libelle="Ajuster la vue" onClick={onAjuster} />
      </div>
    </div>
  );
}

/** Bandeau en haut du plan : aide de l'outil et, s'il y a lieu, choix du type. */
export function Bandeau<T extends string>({
  aide,
  choix,
}: {
  aide: ReactNode;
  choix?: { libelle: string; valeur: T; options: readonly { valeur: T; libelle: string }[]; onChange: (v: T) => void };
}) {
  return (
    <div className="plan2d-bandeau" role={choix ? undefined : 'status'}>
      <p className="plan2d-bandeau-aide">{aide}</p>
      {choix && (
        <div className="plan2d-puces" role="group" aria-label={choix.libelle}>
          {choix.options.map((o) => (
            <button
              key={o.valeur}
              type="button"
              className="plan2d-puce"
              aria-pressed={o.valeur === choix.valeur}
              onClick={() => choix.onChange(o.valeur)}
            >
              {o.libelle}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Barre du tracé d'une nouvelle pièce, au-dessus de la pilule « Plan actuel / Plan rénové ». */
export function BarreDessin({
  nombrePoints,
  onAnnulerPoint,
  onFermer,
  onAbandonner,
}: {
  nombrePoints: number;
  onAnnulerPoint: () => void;
  onFermer: () => void;
  onAbandonner: () => void;
}) {
  return (
    <div className="plan2d-barre-dessin" role="toolbar" aria-label="Tracé de la pièce">
      <BoutonIcone icone="annuler" libelle="Annuler le dernier point" disabled={nombrePoints === 0} onClick={onAnnulerPoint} />
      <span className="plan2d-barre-info">{nombrePoints > 1 ? `${nombrePoints} points` : `${nombrePoints} point`}</span>
      <Bouton icone="valider" disabled={nombrePoints < 3} onClick={onFermer}>
        Fermer la pièce
      </Bouton>
      <BoutonIcone icone="fermer" libelle="Abandonner le tracé" onClick={onAbandonner} />
    </div>
  );
}

/** Carte centrée affichée quand le niveau n'a encore aucune pièce. */
export function EtatVidePlan({ onRelever, onDessiner }: { onRelever: () => void; onDessiner: () => void }) {
  return (
    <div className="plan2d-vide">
      <div className="carte plan2d-vide-carte">
        <Icone nom="plan" taille={40} epaisseur={1.5} />
        <h2>Aucune pièce sur ce niveau</h2>
        <p>Relevez une pièce sur place, ou dessinez-la directement sur le plan.</p>
        <Bouton icone="cible" pleineLargeur onClick={onRelever}>
          Relever une pièce
        </Bouton>
        <Bouton variante="contour" icone="crayon" pleineLargeur onClick={onDessiner}>
          Dessiner une pièce
        </Bouton>
      </div>
    </div>
  );
}
