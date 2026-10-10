// Réglages du chantier : informations, niveaux, catalogue (murs, sols),
// règles du métré, sauvegarde / transfert et suppression du chantier.

import { useMemo } from 'react';
import { useEtat } from '../../store/etat';
import { pluriel } from '../accueil/presentation';
import { BarreHaut, Bouton, ChampNombre, ChampTexte, Interrupteur } from '../commun/composants';
import { confirmer, notifier } from '../commun/dialogues';
import { naviguer } from '../routeur';
import { useProjetOuvert } from '../useProjetOuvert';
import { partageFichiersDisponible, partagerChantier, telechargerChantier } from './actionsSauvegarde';
import { modifierChantier, nouvelleSessionSaisie, TexteObligatoire } from './champs';
import { SectionRevetements, SectionTypesMurs } from './SectionCatalogue';
import { SectionNiveaux } from './SectionNiveaux';
import './parametres.css';

export function EcranParametres({ id }: { id: string }) {
  const projet = useProjetOuvert(id);
  const nombrePhotos = useEtat((e) => e.photos.length);
  const partage = useMemo(() => partageFichiersDisponible(), []);

  if (!projet) return <div className="chargement">Chargement du chantier…</div>;

  const supprimerChantier = async () => {
    const ok = await confirmer({
      titre: `Supprimer « ${projet.nom} » ?`,
      message: `Le plan, le métré${nombrePhotos > 0 ? ` et ${pluriel(nombrePhotos, 'photo')}` : ''} de ce chantier seront effacés de cet appareil. Cette action est définitive : exportez d’abord le chantier pour en garder une copie.`,
      libelleConfirmer: 'Supprimer définitivement',
      danger: true,
    });
    if (!ok) return;
    try {
      await useEtat.getState().supprimerProjet(projet.id);
    } catch (e) {
      console.error('Suppression impossible', e);
      notifier('Suppression impossible, réessayez.', { erreur: true });
      return;
    }
    naviguer({ ecran: 'accueil' }, { remplacer: true });
    notifier(`Chantier « ${projet.nom} » supprimé`);
  };

  const p = projet.parametres;
  return (
    <div className="ecran">
      <BarreHaut
        titre="Réglages du chantier"
        sousTitre={projet.nom}
        onRetour={() => naviguer({ ecran: 'chantier', id })}
        libelleRetour="Retour au plan"
      />
      {/* Chaque champ touché ouvre une nouvelle étape d'annulation (frappe regroupée). */}
      <main className="ecran-contenu etroit reglages" onFocus={nouvelleSessionSaisie}>
        <section aria-labelledby="reglages-titre-infos">
          <h2 id="reglages-titre-infos" className="titre-section">
            Informations
          </h2>
          <div className="carte">
            <TexteObligatoire
              libelle="Nom du chantier"
              valeur={projet.nom}
              messageVide="Le chantier doit garder un nom."
              onChange={(v) => modifierChantier((x) => (x.nom = v), 'nom')}
            />
            <ChampTexte
              libelle="Client"
              valeur={projet.client}
              placeholder="Nom du client ou du maître d’ouvrage"
              onChange={(v) => modifierChantier((x) => (x.client = v), 'client')}
            />
            <ChampTexte
              libelle="Adresse du chantier"
              valeur={projet.adresse}
              placeholder="Rue, ville"
              onChange={(v) => modifierChantier((x) => (x.adresse = v), 'adresse')}
            />
            <ChampTexte
              libelle="Notes"
              multiligne
              valeur={projet.notes}
              placeholder="Accès, codes, contacts, points d’attention…"
              onChange={(v) => modifierChantier((x) => (x.notes = v), 'notes')}
            />
          </div>
        </section>

        <SectionNiveaux projet={projet} />
        <SectionTypesMurs projet={projet} />
        <SectionRevetements projet={projet} />

        <section aria-labelledby="reglages-titre-metre">
          <h2 id="reglages-titre-metre" className="titre-section">
            Métré
          </h2>
          <div className="carte">
            <Interrupteur
              libelle="Déduire les ouvertures des surfaces à peindre"
              aide="Portes, fenêtres et passages sont retirés des murs à peindre (surfaces « hors ouvrants »)."
              coche={p.deduireOuvertures}
              onChange={(v) => modifierChantier((x) => (x.parametres.deduireOuvertures = v))}
            />
            {p.deduireOuvertures && (
              <ChampNombre
                libelle="Ne pas déduire les ouvertures de moins de"
                unite="m²"
                decimales={2}
                min={0}
                max={50}
                valeur={p.seuilDeductionOuverture}
                aide="0 : toutes les ouvertures sont déduites, même les plus petites."
                onChange={(v) => modifierChantier((x) => (x.parametres.seuilDeductionOuverture = v))}
              />
            )}
          </div>
        </section>

        <section aria-labelledby="reglages-titre-sauvegarde">
          <h2 id="reglages-titre-sauvegarde" className="titre-section">
            Sauvegarde
          </h2>
          <div className="carte">
            <p className="reglages-texte">
              Le chantier n’est enregistré que sur cet appareil. Le fichier exporté contient le plan, les réglages et{' '}
              {nombrePhotos > 0 ? `les ${pluriel(nombrePhotos, 'photo')}` : 'les photos'} ; il s’ouvre sur un autre
              téléphone ou un PC avec « Importer un chantier », depuis l’accueil.
            </p>
            <div className="reglages-actions">
              <Bouton icone="telecharger" onClick={() => void telechargerChantier(projet.id)}>
                Exporter le chantier
              </Bouton>
              {partage && (
                <Bouton variante="contour" icone="partager" onClick={() => void partagerChantier(projet.id)}>
                  Partager
                </Bouton>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="reglages-titre-danger">
          <h2 id="reglages-titre-danger" className="titre-section reglages-titre-danger">
            Zone sensible
          </h2>
          <div className="carte reglages-danger">
            <p className="reglages-texte">
              Supprimer le chantier efface définitivement de cet appareil son plan, son métré et ses photos.
            </p>
            <Bouton variante="danger" icone="poubelle" onClick={() => void supprimerChantier()}>
              Supprimer le chantier
            </Bouton>
          </div>
        </section>
      </main>
    </div>
  );
}
