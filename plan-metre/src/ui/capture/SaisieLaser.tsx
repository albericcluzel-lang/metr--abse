// Relevé au mètre laser : saisie successive des côtés et des virages, avec
// aperçu en direct et fermeture automatique de la pièce.

import { useRef, useState } from 'react';
import { BarreHaut, Bouton, ChampNombre, FeuilleBas } from '../commun/composants';
import { confirmer } from '../commun/dialogues';
import { Icone } from '../commun/Icone';
import { ApercuLaser } from './Apercus';
import { IconeReleve } from './IconeReleve';
import {
  construirePolygoneLaser,
  ECART_ALERTE_CM,
  libelleVirage,
  tracerLaser,
  VIRAGE_DROITE,
  VIRAGE_GAUCHE,
  virageDepuisAngleInterieur,
  type CoteLaser,
} from './laser';
import { zoneLaser, type ZoneRelevee } from './zones';

export function SaisieLaser({
  hauteurDefaut,
  onValider,
  onRetour,
}: {
  hauteurDefaut: number;
  onValider: (zone: ZoneRelevee, coteCalcule: number | null) => void;
  /** `enCours` : des mesures ont déjà été saisies. */
  onRetour: (enCours: boolean) => void;
}) {
  const [cotes, setCotes] = useState<CoteLaser[]>([]);
  // NaN = champ vide.
  const [longueur, setLongueur] = useState(NaN);
  const [hauteur, setHauteur] = useState(hauteurDefaut);
  const [message, setMessage] = useState<string | null>(null);
  const [feuilleAngle, setFeuilleAngle] = useState(false);
  const [angleInterieur, setAngleInterieur] = useState(135);
  const panneau = useRef<HTMLDivElement>(null);

  const longueurValide = Number.isFinite(longueur) && longueur > 0;
  // Le côté en cours de saisie compte déjà dans l'aperçu et dans la fermeture.
  const cotesApercu = longueurValide ? [...cotes, { longueur, virage: 0 }] : cotes;
  const trace = tracerLaser(cotesApercu);
  const numero = cotes.length + 1;
  const ecart = Math.round(trace.ecartFermeture * 10) / 10;

  const focaliserChamp = () => panneau.current?.querySelector<HTMLInputElement>('input')?.focus();

  const exigerLongueur = (): boolean => {
    if (longueurValide) return true;
    setMessage(`Saisissez d’abord la longueur du côté ${numero}.`);
    focaliserChamp();
    return false;
  };

  const tourner = (virage: number) => {
    if (!exigerLongueur()) return;
    setCotes([...cotes, { longueur, virage }]);
    setLongueur(NaN);
    setMessage(null);
  };

  const annulerDernier = () => {
    const dernier = cotes[cotes.length - 1];
    if (!dernier) return;
    setCotes(cotes.slice(0, -1));
    // On remet sa longueur dans le champ pour la corriger ou changer de virage.
    setLongueur(dernier.longueur);
    setMessage(null);
  };

  const fermer = async () => {
    if (cotesApercu.length < 2) {
      setMessage('Saisissez au moins deux côtés pour fermer la pièce.');
      focaliserChamp();
      return;
    }
    const r = construirePolygoneLaser(cotesApercu);
    if (!r.valide) {
      setMessage('Les côtés se croisent : vérifiez le sens des virages (tour dans le sens des aiguilles d’une montre).');
      return;
    }
    if (r.ecartImportant) {
      const ok = await confirmer({
        titre: 'Écart de fermeture important',
        message: `La fin du dernier côté tombe à ${ecart.toLocaleString('fr-FR')} cm du point de départ. Vérifiez les mesures ; si vous fermez, le dernier sommet rejoint le premier.`,
        libelleConfirmer: 'Fermer quand même',
        libelleAnnuler: 'Vérifier',
      });
      if (!ok) return;
    }
    onValider(zoneLaser(r.points, hauteur), r.coteFermetureCalcule ? ecart : null);
  };

  const validerAngle = () => {
    setFeuilleAngle(false);
    tourner(virageDepuisAngleInterieur(angleInterieur));
  };

  let infoFermeture: string;
  if (trace.sommets.length === 0) infoFermeture = 'Commencez par n’importe quel angle de la pièce.';
  else if (ecart < 0.5) infoFermeture = 'La pièce est fermée : touchez « Fermer la pièce ».';
  else if (ecart <= ECART_ALERTE_CM) infoFermeture = `Écart de fermeture : ${ecart.toLocaleString('fr-FR')} cm.`;
  else infoFermeture = `Segment de fermeture (pointillés) : ${ecart.toLocaleString('fr-FR')} cm.`;

  return (
    <div className="ecran">
      <BarreHaut titre="Mètre laser" sousTitre={`Côté ${numero}`} onRetour={() => onRetour(cotesApercu.length > 0)} />
      <div className="releve-laser">
        <div className="releve-laser-apercu">
          <ApercuLaser trace={trace} coteEnCours={longueurValide} />
        </div>
        <div className="releve-laser-panneau" ref={panneau}>
          <p className="releve-consigne">
            <Icone nom="info" taille={18} />
            <span>
              Faites le tour de la pièce dans le sens des aiguilles d’une montre. Saisissez le côté, puis indiquez le virage
              vers le suivant.
            </span>
          </p>
          <p className="releve-fermeture" aria-live="polite">
            {infoFermeture}
          </p>
          <ChampNombre
            key={numero}
            libelle={`Côté ${numero}`}
            valeur={longueur}
            onChange={setLongueur}
            unite="cm"
            min={1}
            max={100000}
            decimales={1}
            autoFocus
          />
          {message && (
            <p className="releve-message" role="alert">
              {message}
            </p>
          )}
          <div className="releve-actions-2">
            <Bouton variante="secondaire" onClick={() => tourner(VIRAGE_DROITE)}>
              <IconeReleve nom="virage-droite" taille={20} />
              Tourner à droite
            </Bouton>
            <Bouton variante="secondaire" onClick={() => tourner(VIRAGE_GAUCHE)}>
              <IconeReleve nom="virage-gauche" taille={20} />
              Tourner à gauche
            </Bouton>
            <Bouton
              variante="contour"
              onClick={() => {
                if (exigerLongueur()) setFeuilleAngle(true);
              }}
            >
              <IconeReleve nom="angle-libre" taille={20} />
              Autre angle…
            </Bouton>
            <Bouton variante="contour" icone="annuler" disabled={cotes.length === 0} onClick={annulerDernier}>
              Annuler le dernier côté
            </Bouton>
          </div>
          <div className="releve-laser-fin">
            <ChampNombre
              libelle="Hauteur sous plafond"
              valeur={hauteur}
              onChange={setHauteur}
              unite="cm"
              min={50}
              max={1000}
              decimales={0}
            />
            <Bouton icone="valider" onClick={() => void fermer()}>
              Fermer la pièce
            </Bouton>
          </div>
        </div>
      </div>

      <FeuilleBas
        ouverte={feuilleAngle}
        titre="Autre angle"
        onFermer={() => setFeuilleAngle(false)}
        pied={
          <>
            <Bouton variante="contour" onClick={() => setFeuilleAngle(false)}>
              Annuler
            </Bouton>
            <Bouton onClick={validerAngle}>Valider le virage</Bouton>
          </>
        }
      >
        <ChampNombre
          libelle="Angle intérieur, mesuré dans la pièce"
          valeur={angleInterieur}
          onChange={setAngleInterieur}
          unite="°"
          min={1}
          max={359}
          decimales={1}
          autoFocus
          aide="90° : angle droit (on tourne à droite) · 270° : angle rentrant (on tourne à gauche) · 135° : pan coupé."
        />
        <p className="releve-consigne">
          <Icone nom="info" taille={18} />
          <span>Au bout du côté {numero}, on tourne {libelleVirage(virageDepuisAngleInterieur(angleInterieur))}.</span>
        </p>
      </FeuilleBas>
    </div>
  );
}
