// Pièce rectangulaire : nom, longueur, largeur, hauteur.

import { useState } from 'react';
import { NOMS_PIECES } from '../../model/catalogue';
import { BarreHaut, Bouton, ChampNombre, ChampTexte } from '../commun/composants';
import { Icone } from '../commun/Icone';
import { ApercuAssemblage } from './Apercus';
import { zoneRectangle, type ZoneRelevee } from './zones';

export function SaisieRectangle({
  hauteurDefaut,
  onValider,
  onRetour,
}: {
  hauteurDefaut: number;
  onValider: (zone: ZoneRelevee) => void;
  /** `enCours` : des mesures ont déjà été saisies. */
  onRetour: (enCours: boolean) => void;
}) {
  const [nom, setNom] = useState('');
  // NaN = champ vide : les dimensions doivent être mesurées.
  const [longueur, setLongueur] = useState(NaN);
  const [largeur, setLargeur] = useState(NaN);
  const [hauteur, setHauteur] = useState(hauteurDefaut);
  const [message, setMessage] = useState<string | null>(null);

  const valide = longueur > 0 && largeur > 0;

  const valider = () => {
    if (!valide) {
      setMessage('Saisissez la longueur et la largeur de la pièce.');
      return;
    }
    onValider(zoneRectangle(nom, longueur, largeur, hauteur));
  };

  return (
    <div className="ecran">
      <BarreHaut
        titre="Pièce rectangulaire"
        onRetour={() => onRetour(Number.isFinite(longueur) || Number.isFinite(largeur))}
      />
      <div className="ecran-contenu etroit">
        <div className="releve-cadre-apercu">
          {valide ? (
            <ApercuAssemblage
              existantes={[]}
              nouvelles={[{ id: 'apercu', nom: nom.trim() || 'Pièce', points: zoneRectangle(nom, longueur, largeur, hauteur).points }]}
            />
          ) : (
            <div className="releve-apercu-vide">
              <Icone nom="rectangle" taille={36} epaisseur={1.5} />
              Longueur × largeur
            </div>
          )}
        </div>
        <ChampTexte libelle="Nom de la pièce" valeur={nom} onChange={setNom} suggestions={NOMS_PIECES} placeholder="ex. Chambre 1" />
        <div className="ligne-champs">
          <ChampNombre libelle="Longueur" valeur={longueur} onChange={setLongueur} unite="cm" min={1} max={100000} autoFocus />
          <ChampNombre libelle="Largeur" valeur={largeur} onChange={setLargeur} unite="cm" min={1} max={100000} />
        </div>
        <ChampNombre libelle="Hauteur sous plafond" valeur={hauteur} onChange={setHauteur} unite="cm" min={50} max={1000} decimales={0} />
        {message && (
          <p className="releve-message" role="alert">
            {message}
          </p>
        )}
        <Bouton pleineLargeur icone="valider" onClick={valider}>
          Ajouter la zone
        </Bouton>
      </div>
    </div>
  );
}
