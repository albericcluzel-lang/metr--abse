// Relevé de pièces (inspiré de Visuary : « Terminer la zone » → « Ajouter une
// zone à la capture » / « Finaliser la capture » → « Sauvegarder et
// continuer »). Trois méthodes : réalité augmentée (ARCore via WebXR), mètre
// laser, pièce rectangulaire. Les zones relevées sont gardées en brouillon
// (stockage de session) jusqu'à leur ajout au plan.

import { useEffect, useRef, useState } from 'react';
import { niveauCourant, useEtat } from '../../store/etat';
import { BarreHaut, Bouton } from '../commun/composants';
import { confirmer, notifier } from '../commun/dialogues';
import { naviguer } from '../routeur';
import { useProjetOuvert } from '../useProjetOuvert';
import { surfaceM2 } from './Apercus';
import { ChoixMethode, type EtatDisponibiliteRA } from './ChoixMethode';
import { EcranRA } from './EcranRA';
import { Finalisation } from './Finalisation';
import { ListeZones } from './ListeZones';
import { SaisieLaser } from './SaisieLaser';
import { SaisieRectangle } from './SaisieRectangle';
import { verifierDisponibiliteRA } from './sessionRA';
import { lireBrouillon, serialiserBrouillon, type MethodeReleve, type ZoneRelevee } from './zones';
import './releve.css';

type Etape = 'methodes' | 'zones' | MethodeReleve | 'finalisation';

function cleBrouillon(id: string): string {
  return `abse-releve-${id}`;
}

function lireBrouillonStocke(id: string): ZoneRelevee[] {
  try {
    return lireBrouillon(sessionStorage.getItem(cleBrouillon(id)));
  } catch {
    return [];
  }
}

function ecrireBrouillonStocke(id: string, zones: readonly ZoneRelevee[]): void {
  try {
    if (zones.length === 0) sessionStorage.removeItem(cleBrouillon(id));
    else sessionStorage.setItem(cleBrouillon(id), serialiserBrouillon(zones));
  } catch {
    // Stockage indisponible (navigation privée) : le relevé reste en mémoire.
  }
}

export function EcranReleve({ id }: { id: string }) {
  // Un relevé (et son brouillon) par chantier.
  return <ReleveChantier key={id} id={id} />;
}

function ReleveChantier({ id }: { id: string }) {
  const projet = useProjetOuvert(id);
  const niveau = useEtat((e) => (e.projet?.id === id ? niveauCourant(e) : null));
  const variante = useEtat((e) => e.variante);
  const brouillon = useRef<ZoneRelevee[] | null>(null);
  if (brouillon.current === null) brouillon.current = lireBrouillonStocke(id);
  const [zones, setZones] = useState<ZoneRelevee[]>(brouillon.current);
  const [etape, setEtape] = useState<Etape>(brouillon.current.length > 0 ? 'zones' : 'methodes');
  const [disponibiliteRA, setDisponibiliteRA] = useState<EtatDisponibiliteRA>('verification');
  const termine = useRef(false);

  useEffect(() => {
    let actif = true;
    void verifierDisponibiliteRA().then((d) => {
      if (actif) setDisponibiliteRA(d);
    });
    return () => {
      actif = false;
    };
  }, []);

  useEffect(() => {
    if (!termine.current) ecrireBrouillonStocke(id, zones);
  }, [id, zones]);

  useEffect(() => {
    const n = brouillon.current?.length ?? 0;
    if (n > 0) notifier(`Relevé en cours retrouvé : ${n} zone${n > 1 ? 's' : ''}`);
  }, []);

  if (!projet) return <div className="chargement">Chargement du chantier…</div>;

  const hauteurDefaut = niveau?.hauteurDefaut ?? 250;
  const quitter = () => naviguer({ ecran: 'chantier', id });

  const ajouterZones = (nouvelles: ZoneRelevee[], message?: string | null) => {
    setZones((z) => [...z, ...nouvelles]);
    setEtape('zones');
    if (message) notifier(message);
  };

  const abandonner = async () => {
    if (zones.length > 0) {
      const ok = await confirmer({
        titre: 'Abandonner le relevé ?',
        message: `${zones.length > 1 ? `Les ${zones.length} zones relevées seront perdues.` : 'La zone relevée sera perdue.'}`,
        libelleConfirmer: 'Abandonner',
        libelleAnnuler: 'Continuer le relevé',
        danger: true,
      });
      if (!ok) return;
    }
    termine.current = true;
    ecrireBrouillonStocke(id, []);
    quitter();
  };

  const retirer = async (zone: ZoneRelevee, index: number) => {
    const ok = await confirmer({
      titre: 'Retirer cette zone ?',
      message: `${zone.nom.trim() || `Zone ${index + 1}`} (${surfaceM2(zone.points)}) ne sera pas ajoutée au plan.`,
      libelleConfirmer: 'Retirer',
      danger: true,
    });
    if (!ok) return;
    const reste = zones.filter((z) => z.id !== zone.id);
    setZones(reste);
    if (reste.length === 0) setEtape('methodes');
  };

  const retourSaisie = async (enCours: boolean) => {
    if (enCours) {
      const ok = await confirmer({
        titre: 'Abandonner cette zone ?',
        message: 'Les mesures saisies pour cette zone seront perdues.',
        libelleConfirmer: 'Abandonner la zone',
        danger: true,
      });
      if (!ok) return;
    }
    setEtape(zones.length > 0 ? 'zones' : 'methodes');
  };

  switch (etape) {
    case 'laser':
      return (
        <SaisieLaser
          hauteurDefaut={hauteurDefaut}
          onRetour={(enCours) => void retourSaisie(enCours)}
          onValider={(zone, coteCalcule) =>
            ajouterZones(
              [zone],
              coteCalcule !== null ? `Zone ajoutée : côté de fermeture calculé (${coteCalcule.toLocaleString('fr-FR')} cm)` : null,
            )
          }
        />
      );
    case 'rectangle':
      return <SaisieRectangle hauteurDefaut={hauteurDefaut} onRetour={(enCours) => void retourSaisie(enCours)} onValider={(z) => ajouterZones([z])} />;
    case 'ra':
      return (
        <EcranRA
          hauteurDefaut={hauteurDefaut}
          onRetour={() => setEtape(zones.length > 0 ? 'zones' : 'methodes')}
          onTerminer={(z, message) => ajouterZones(z, message)}
        />
      );
    case 'finalisation':
      return (
        <Finalisation
          projet={projet}
          zones={zones}
          niveauInitialId={niveau?.id ?? null}
          varianteInitiale={variante}
          onRetour={() => setEtape('zones')}
          onTerminee={() => {
            termine.current = true;
            ecrireBrouillonStocke(id, []);
            naviguer({ ecran: 'chantier', id });
          }}
        />
      );
    case 'zones':
      return (
        <div className="ecran">
          <BarreHaut titre="Relevé de pièces" sousTitre={projet.nom} onRetour={() => void abandonner()} libelleRetour="Abandonner le relevé" />
          <div className="ecran-contenu etroit">
            <h2 className="titre-section">
              Zones relevées ({zones.length})
            </h2>
            <ListeZones zones={zones} onRetirer={(z, i) => void retirer(z, i)} />
            <p className="releve-astuce">
              <span>Ajoutez d’autres zones, puis finalisez pour les poser sur le plan.</span>
            </p>
          </div>
          <div className="releve-pied releve-pied-double">
            <Bouton variante="contour" icone="plus" onClick={() => setEtape('methodes')}>
              Ajouter une zone à la capture
            </Bouton>
            <Bouton icone="valider" onClick={() => setEtape('finalisation')}>
              Finaliser la capture
            </Bouton>
          </div>
        </div>
      );
    case 'methodes':
      return (
        <div className="ecran">
          <BarreHaut
            titre={zones.length > 0 ? 'Ajouter une zone' : 'Relever une pièce'}
            sousTitre={projet.nom}
            onRetour={zones.length > 0 ? () => setEtape('zones') : quitter}
            libelleRetour={zones.length > 0 ? 'Retour aux zones relevées' : 'Retour au plan'}
          />
          <div className="ecran-contenu etroit">
            <p className="releve-intro">Comment voulez-vous relever la pièce ?</p>
            <ChoixMethode disponibiliteRA={disponibiliteRA} onChoisir={setEtape} />
          </div>
        </div>
      );
  }
}
