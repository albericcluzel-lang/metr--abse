// Création d'un chantier : nom obligatoire, client et adresse facultatifs,
// puis ouverture directe du plan.

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useEtat } from '../../store/etat';
import { Bouton, ChampTexte, FeuilleBas } from '../commun/composants';
import { notifier } from '../commun/dialogues';
import { naviguer } from '../routeur';

export function FeuilleNouveauChantier({ ouverte, onFermer }: { ouverte: boolean; onFermer: () => void }) {
  const idFormulaire = useId();
  const [nom, setNom] = useState('');
  const [client, setClient] = useState('');
  const [adresse, setAdresse] = useState('');
  const [tente, setTente] = useState(false);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouverte) return;
    setNom('');
    setClient('');
    setAdresse('');
    setTente(false);
  }, [ouverte]);

  const nomManquant = tente && nom.trim() === '';

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    if (enCours) return;
    if (nom.trim() === '') {
      setTente(true);
      return;
    }
    setEnCours(true);
    try {
      const p = await useEtat.getState().creerProjet({ nom, client, adresse });
      onFermer();
      naviguer({ ecran: 'chantier', id: p.id });
    } catch (err) {
      console.error('Création impossible', err);
      notifier('Création impossible : l’espace de stockage de l’appareil est peut-être plein.', { erreur: true });
    } finally {
      setEnCours(false);
    }
  };

  return (
    <FeuilleBas
      ouverte={ouverte}
      titre="Nouveau chantier"
      onFermer={onFermer}
      pied={
        <>
          <Bouton variante="contour" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton type="submit" form={idFormulaire} disabled={enCours}>
            Créer le chantier
          </Bouton>
        </>
      }
    >
      <form id={idFormulaire} onSubmit={(e) => void valider(e)} noValidate>
        <div className={nomManquant ? 'accueil-champ-erreur' : undefined}>
          <ChampTexte
            libelle="Nom du chantier (obligatoire)"
            valeur={nom}
            onChange={setNom}
            placeholder="Ex. : Villa Dupont, rénovation R+1"
            autoFocus
            aide={nomManquant ? 'Donnez un nom au chantier pour le retrouver dans la liste.' : undefined}
          />
        </div>
        <ChampTexte libelle="Client" valeur={client} onChange={setClient} placeholder="Nom du client ou du maître d’ouvrage" />
        <ChampTexte libelle="Adresse du chantier" valeur={adresse} onChange={setAdresse} placeholder="Rue, ville" />
      </form>
    </FeuilleBas>
  );
}
