// Zones relevées pendant la capture, avant leur ajout au plan.

import { BoutonIcone } from '../commun/composants';
import { Icone } from '../commun/Icone';
import { surfaceM2, VignetteZone } from './Apercus';
import { LIBELLES_METHODES, type ZoneRelevee } from './zones';

export function nomAffiche(zone: ZoneRelevee, index: number): string {
  return zone.nom.trim() || `Zone ${index + 1}`;
}

export function ListeZones({ zones, onRetirer }: { zones: readonly ZoneRelevee[]; onRetirer: (zone: ZoneRelevee, index: number) => void }) {
  return (
    <ul className="liste releve-zones" aria-label="Zones relevées">
      {zones.map((z, i) => (
        <li key={z.id} className="releve-zone">
          <span className="releve-zone-vignette">
            <VignetteZone points={z.points} />
            <span className="releve-zone-coche" aria-hidden="true">
              <Icone nom="valider" taille={14} epaisseur={3} />
            </span>
          </span>
          <span className="element-liste-texte">
            <span className="element-liste-titre releve-zone-titre">
              {nomAffiche(z, i)}
              <span className="releve-zone-surface">{surfaceM2(z.points)}</span>
            </span>
            <span className="element-liste-detail">
              {LIBELLES_METHODES[z.methode]} · hauteur {Math.round(z.hauteur)} cm
            </span>
          </span>
          <BoutonIcone icone="poubelle" libelle={`Retirer ${nomAffiche(z, i)}`} onClick={() => onRetirer(z, i)} />
        </li>
      ))}
    </ul>
  );
}
