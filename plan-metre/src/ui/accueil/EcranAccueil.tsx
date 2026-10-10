// Accueil : liste des chantiers enregistrés sur l'appareil, création, import
// d'un fichier de sauvegarde, installation de l'appli.

import { useEffect, useMemo, useState } from 'react';
import type { Projet } from '../../model/types';
import { useEtat } from '../../store/etat';
import * as persistance from '../../store/persistance';
import { BarreHaut, Bouton, BoutonIcone, EtatVide, MenuActions, type EntreeMenu } from '../commun/composants';
import { confirmer, notifier } from '../commun/dialogues';
import { Icone, type NomIcone } from '../commun/Icone';
import { partageFichiersDisponible, partagerChantier, telechargerChantier } from '../parametres/actionsSauvegarde';
import { naviguer } from '../routeur';
import { useImportChantier } from './ImportChantier';
import { lancerInstallation, useInstallation } from './installation';
import { FeuilleNouveauChantier } from './NouveauChantier';
import {
  apercuPlan,
  detailChantier,
  filtrerChantiers,
  formaterModification,
  formaterOctets,
  pluriel,
  resumerChantier,
  trierChantiers,
} from './presentation';
import './accueil.css';

/** Au-delà de ce nombre de chantiers, une recherche s'affiche. */
const SEUIL_RECHERCHE = 5;
const CLE_INSTALLATION_MASQUEE = 'abse-accueil-installation-masquee';

export function EcranAccueil() {
  const projets = useEtat((e) => e.projets);
  const [recherche, setRecherche] = useState('');
  const [creation, setCreation] = useState(false);
  const { choisirFichier, rendu: renduImport } = useImportChantier();
  const partage = useMemo(() => partageFichiersDisponible(), []);

  const tries = useMemo(() => trierChantiers(projets), [projets]);
  const avecRecherche = projets.length > SEUIL_RECHERCHE;
  const affiches = useMemo(
    () => (avecRecherche ? filtrerChantiers(tries, recherche) : tries),
    [avecRecherche, tries, recherche],
  );
  const vide = projets.length === 0;

  return (
    <div className="ecran accueil">
      <BarreHaut
        titre="Mes chantiers"
        sousTitre={vide ? undefined : pluriel(projets.length, 'chantier')}
        actions={
          !vide && (
            <Bouton
              variante="fantome"
              icone="televerser"
              className="accueil-importer"
              aria-label="Importer un chantier"
              title="Importer un chantier"
              onClick={choisirFichier}
            >
              Importer
            </Bouton>
          )
        }
      />

      <main className="ecran-contenu etroit accueil-contenu">
        {vide ? (
          <>
            <AccueilVide onCreer={() => setCreation(true)} onImporter={choisirFichier} />
            <CarteInstallation />
          </>
        ) : (
          <>
            <CarteInstallation />
            {avecRecherche && (
              <div className="saisie accueil-recherche">
                <IconeLocale nom="loupe" />
                <input
                  type="search"
                  aria-label="Rechercher un chantier"
                  placeholder="Rechercher : nom, client, adresse"
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                />
              </div>
            )}
            <ul className="accueil-liste" aria-label="Chantiers">
              {affiches.map((p) => (
                <li key={p.id}>
                  <CarteChantier projet={p} partage={partage} />
                </li>
              ))}
            </ul>
            {affiches.length === 0 && (
              <p className="accueil-aucun">Aucun chantier ne correspond à « {recherche.trim()} ».</p>
            )}
          </>
        )}
        <EncartStockage />
      </main>

      {!vide && (
        <Bouton className="accueil-fab" icone="plus" onClick={() => setCreation(true)}>
          Nouveau chantier
        </Bouton>
      )}
      <FeuilleNouveauChantier ouverte={creation} onFermer={() => setCreation(false)} />
      {renduImport}
    </div>
  );
}

// ─── Carte d'un chantier ───────────────────────────────────────────────────

function CarteChantier({ projet, partage }: { projet: Projet; partage: boolean }) {
  // Calculs légers, refaits à chaque rendu : un chantier modifié sur place (import) reste à jour.
  const detail = detailChantier(resumerChantier(projet));
  const apercu = apercuPlan(projet);
  const lieu = projet.adresse || projet.client;

  const ouvrir = () => naviguer({ ecran: 'chantier', id: projet.id });

  const supprimer = async () => {
    // Nombre de photos pour le message (0 si la lecture échoue : la confirmation reste possible).
    const photos = await persistance.listerPhotos(projet.id).then(
      (liste) => liste.length,
      () => 0,
    );
    const ok = await confirmer({
      titre: `Supprimer « ${projet.nom} » ?`,
      message: `Le plan, le métré${photos > 0 ? ` et ${pluriel(photos, 'photo')}` : ''} de ce chantier seront effacés de cet appareil. Exportez-le d’abord si vous voulez en garder une copie.`,
      libelleConfirmer: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await useEtat.getState().supprimerProjet(projet.id);
      notifier(`Chantier « ${projet.nom} » supprimé`);
    } catch (e) {
      console.error('Suppression impossible', e);
      notifier('Suppression impossible, réessayez.', { erreur: true });
    }
  };

  const entrees: EntreeMenu[] = [
    { libelle: 'Ouvrir', icone: 'plan', action: ouvrir },
    { libelle: 'Exporter', icone: 'telecharger', action: () => void telechargerChantier(projet.id) },
    ...(partage ? [{ libelle: 'Partager', icone: 'partager' as const, action: () => void partagerChantier(projet.id) }] : []),
    { libelle: 'Supprimer', icone: 'poubelle', action: () => void supprimer(), danger: true, separateurAvant: true },
  ];

  return (
    <article className="accueil-carte" data-projet={projet.id}>
      <button type="button" className="accueil-carte-principal" onClick={ouvrir}>
        <ApercuPlan apercu={apercu} />
        <span className="accueil-carte-texte">
          <span className="accueil-carte-nom">{projet.nom}</span>
          {lieu && <span className="accueil-carte-lieu">{lieu}</span>}
          <span className="accueil-carte-detail">{detail}</span>
          <span className="accueil-carte-date">{formaterModification(projet.modifieLe)}</span>
        </span>
      </button>
      <div className="accueil-carte-menu">
        <MenuActions entrees={entrees} libelle={`Actions pour « ${projet.nom} »`} />
      </div>
    </article>
  );
}

function ApercuPlan({ apercu }: { apercu: ReturnType<typeof apercuPlan> }) {
  if (!apercu) {
    return (
      <span className="accueil-apercu accueil-apercu-vide" aria-hidden="true">
        <Icone nom="plan" taille={24} epaisseur={1.6} />
      </span>
    );
  }
  return (
    <span className="accueil-apercu" aria-hidden="true">
      <svg viewBox={apercu.viewBox} preserveAspectRatio="xMidYMid meet">
        {apercu.pieces.map((p) => (
          <polygon key={p.id} points={p.points} style={p.couleur ? { fill: p.couleur } : undefined} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </span>
  );
}

// ─── État vide ─────────────────────────────────────────────────────────────

const ETAPES: { icone: NomIcone; libelle: string }[] = [
  { icone: 'cible', libelle: 'Relevé des pièces' },
  { icone: 'plan', libelle: 'Plan 2D et 3D' },
  { icone: 'metre', libelle: 'Métré automatique' },
];

function AccueilVide({ onCreer, onImporter }: { onCreer: () => void; onImporter: () => void }) {
  return (
    <EtatVide icone="maison" titre="Aucun chantier pour l’instant">
      <p className="accueil-vide-texte">
        Créez votre premier chantier : relevez les pièces avec le téléphone, le plan et le métré se font tout seuls.
      </p>
      <ol className="accueil-etapes">
        {ETAPES.map((e, i) => (
          <li key={e.libelle}>
            <span className="accueil-etape-icone">
              <Icone nom={e.icone} taille={22} />
            </span>
            <span>
              <span className="visuellement-cache">Étape {i + 1} : </span>
              {e.libelle}
            </span>
          </li>
        ))}
      </ol>
      <div className="accueil-vide-actions">
        <Bouton icone="plus" pleineLargeur onClick={onCreer}>
          Nouveau chantier
        </Bouton>
        <Bouton variante="contour" icone="televerser" pleineLargeur onClick={onImporter}>
          Importer un chantier
        </Bouton>
      </div>
    </EtatVide>
  );
}

// ─── Installation et stockage ──────────────────────────────────────────────

function lireMasquage(): boolean {
  try {
    return localStorage.getItem(CLE_INSTALLATION_MASQUEE) === '1';
  } catch {
    return false;
  }
}

function CarteInstallation() {
  const etat = useInstallation();
  const [masquee, setMasquee] = useState(lireMasquage);
  const [telephone] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
  if (etat === 'installee' || masquee) return null;

  const masquer = () => {
    setMasquee(true);
    try {
      localStorage.setItem(CLE_INSTALLATION_MASQUEE, '1');
    } catch {
      // Stockage indisponible (navigation privée) : masquée pour cette visite seulement.
    }
  };
  const installer = async () => {
    try {
      if (await lancerInstallation()) notifier('Appli installée : retrouvez-la sur l’écran d’accueil');
    } catch (e) {
      console.error('Installation impossible', e);
      notifier('Installation impossible depuis ce bouton : passez par le menu de Chrome.', { erreur: true });
    }
  };

  return (
    <section className="accueil-installation" aria-labelledby="accueil-installation-titre">
      <img className="accueil-installation-logo" src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={44} height={44} />
      <div className="accueil-installation-texte">
        <h2 id="accueil-installation-titre">Installer l’appli</h2>
        <p>Une icône sur l’écran d’accueil, en plein écran, et utilisable sans réseau sur le chantier.</p>
        {etat === 'proposable' ? (
          <Bouton icone="telecharger" onClick={() => void installer()}>
            Installer l’appli sur {telephone ? 'ce téléphone' : 'cet ordinateur'}
          </Bouton>
        ) : (
          <p className="accueil-installation-aide">
            Dans Chrome : menu <strong>⋮</strong> → <strong>Installer l’application</strong>
            {!telephone && ' (ou l’icône d’installation au bout de la barre d’adresse)'}
          </p>
        )}
      </div>
      <BoutonIcone icone="fermer" libelle="Masquer ce conseil" onClick={masquer} />
    </section>
  );
}

function EncartStockage() {
  const projets = useEtat((e) => e.projets);
  const [usage, setUsage] = useState<number | null>(null);
  useEffect(() => {
    let actif = true;
    navigator.storage
      ?.estimate?.()
      .then((e) => {
        if (actif && typeof e.usage === 'number') setUsage(e.usage);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [projets]);
  return (
    <aside className="accueil-encart">
      <Icone nom="info" taille={20} />
      <p>
        Vos chantiers sont enregistrés sur cet appareil uniquement : exportez-les pour les sauvegarder ou les ouvrir sur
        un autre appareil.
        {usage !== null && <span className="accueil-encart-espace"> Espace utilisé : {formaterOctets(usage)}.</span>}
      </p>
    </aside>
  );
}

// ─── Icônes propres à l'accueil ────────────────────────────────────────────

const CHEMINS_LOCAUX = {
  loupe: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
} as const;

function IconeLocale({ nom }: { nom: keyof typeof CHEMINS_LOCAUX }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={CHEMINS_LOCAUX[nom]} />
    </svg>
  );
}
