// Vue 3D orientable du plan affiché (module « vue 3D »).
//
// Remplit son conteneur (.chantier-zone). La maquette est reconstruite à
// chaque changement de plan (annuler / rétablir, niveau, plan actuel / rénové) ;
// le moteur WebGL, lui, reste en place tant que la vue est affichée.
//
// Le moteur (et three.js, volumineux) n'est chargé qu'à la première ouverture
// de la vue 3D : le démarrage de l'appli sur le téléphone n'en pâtit pas.

import { useEffect, useRef, useState } from 'react';
import type { Catalogue, Plan } from '../../model/types';
import { BoutonIcone, EtatVide } from '../commun/composants';
import type { MoteurVue3D } from './moteur';
import './vue3d.css';

export interface ProprietesVue3D {
  plan: Plan;
  catalogue: Catalogue;
}

type EtatVue = 'demarrage' | 'pret' | 'indisponible' | 'interrompu' | 'echec';

const DUREE_AIDE = 10_000;

function ecranTactile(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function Vue3D({ plan, catalogue }: ProprietesVue3D) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const calqueRef = useRef<HTMLDivElement>(null);
  const moteurRef = useRef<MoteurVue3D | null>(null);
  // Dernier plan reçu, pour le moteur qui arrive après le chargement du module.
  const planRef = useRef({ plan, catalogue });
  const [etat, setEtat] = useState<EtatVue>('demarrage');
  const [aide, setAide] = useState(true);
  const [tactile] = useState(ecranTactile);

  // Moteur : créé au montage, libéré au démontage.
  useEffect(() => {
    const zone = zoneRef.current;
    const calque = calqueRef.current;
    if (!zone || !calque) return;
    let actif = true;
    let moteur: MoteurVue3D | null = null;
    import('./moteur')
      .then(({ MoteurVue3D }) => {
        if (!actif) return;
        moteur = MoteurVue3D.creer(zone, calque, {
          surInteraction: () => setAide(false),
          surContexte: (ok) => setEtat(ok ? 'pret' : 'interrompu'),
        });
        if (!moteur) {
          setEtat('indisponible');
          return;
        }
        moteurRef.current = moteur;
        moteur.afficherPlan(planRef.current.plan, planRef.current.catalogue);
        setEtat('pret');
      })
      .catch((e: unknown) => {
        console.warn('Vue 3D : chargement impossible', e);
        if (actif) setEtat('echec');
      });
    return () => {
      actif = false;
      moteur?.liberer();
      moteurRef.current = null;
    };
  }, []);

  // La consigne des gestes s'efface d'elle-même au bout de quelques secondes.
  useEffect(() => {
    if (!aide) return;
    const minuteur = setTimeout(() => setAide(false), DUREE_AIDE);
    return () => clearTimeout(minuteur);
  }, [aide]);

  // Maquette : reconstruite quand le plan change.
  useEffect(() => {
    if (planRef.current.plan === plan && planRef.current.catalogue === catalogue) return;
    planRef.current = { plan, catalogue };
    moteurRef.current?.afficherPlan(plan, catalogue);
  }, [plan, catalogue]);

  const pieces = plan.pieces.filter((p) => p.sommets.length >= 3);
  const description =
    pieces.length > 0
      ? `Vue 3D du plan : ${pieces.map((p) => p.nom).join(', ')}.`
      : 'Vue 3D du plan : aucune pièce.';
  const consigne = tactile
    ? 'Un doigt : tourner · deux doigts : zoomer, déplacer'
    : 'Glisser : tourner · molette : zoomer · clic droit : déplacer';

  return (
    <div className="vue3d" data-etat={etat} data-pieces={pieces.length}>
      <div
        ref={zoneRef}
        className="vue3d-zone"
        role="application"
        aria-roledescription="vue 3D"
        aria-label={`${description} ${consigne}. Au clavier : flèches pour déplacer, + et − pour zoomer.`}
        tabIndex={0}
      />
      <div ref={calqueRef} className="vue3d-etiquettes" aria-hidden="true" />

      {etat === 'demarrage' && <p className="vue3d-chargement">Préparation de la vue 3D…</p>}
      {etat === 'echec' && (
        <div className="vue3d-message">
          <EtatVide icone="alerte" titre="Vue 3D non chargée">
            <p>Le module 3D n’a pas pu être chargé. Vérifiez la connexion, puis rouvrez la vue 3D.</p>
          </EtatVide>
        </div>
      )}
      {etat === 'indisponible' && (
        <div className="vue3d-message">
          <EtatVide icone="alerte" titre="Vue 3D indisponible">
            <p>
              Cet appareil ou ce navigateur ne permet pas l’affichage 3D (WebGL&nbsp;2). Mettez Chrome à jour ou activez
              l’accélération matérielle ; le plan 2D et le métré restent utilisables.
            </p>
          </EtatVide>
        </div>
      )}
      {etat === 'interrompu' && (
        <div className="vue3d-message">
          <EtatVide icone="alerte" titre="Affichage 3D interrompu">
            <p>Le téléphone a suspendu l’affichage 3D. Il reprend tout seul ; sinon, repassez en 2D puis en 3D.</p>
          </EtatVide>
        </div>
      )}
      {etat === 'pret' && pieces.length === 0 && (
        <div className="vue3d-message">
          <EtatVide icone="cube" titre="Aucune pièce sur ce niveau">
            <p>Ajoutez une pièce avec le bouton + pour la voir en 3D.</p>
          </EtatVide>
        </div>
      )}
      {etat === 'pret' && pieces.length > 0 && aide && (
        <p className="vue3d-aide" aria-hidden="true">
          {consigne}
        </p>
      )}

      <BoutonIcone
        flottant
        icone="ajuster"
        libelle="Recentrer la vue"
        className="vue3d-recentrer"
        disabled={etat !== 'pret' || pieces.length === 0}
        onClick={() => moteurRef.current?.recentrer()}
      />
    </div>
  );
}
