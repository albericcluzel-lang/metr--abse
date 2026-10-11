// Import d'un chantier depuis un fichier de sauvegarde (.abse.json) : lecture,
// contrôle, puis choix « Remplacer » / « Importer comme copie » si le chantier
// existe déjà sur l'appareil.

import { useCallback, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { Projet } from '../../model/types';
import { useEtat } from '../../store/etat';
import {
  ACCEPT_IMPORT,
  chantierExiste,
  ErreurSauvegarde,
  importerSauvegarde,
  lireFichierSauvegarde,
  type FichierSauvegarde,
  type ModeImport,
} from '../../store/sauvegarde';
import { Bouton, FeuilleBas } from '../commun/composants';
import { notifier } from '../commun/dialogues';
import { Icone } from '../commun/Icone';
import { formaterModification, pluriel } from './presentation';

type Etape =
  | { type: 'lecture'; nomFichier: string }
  | { type: 'erreur'; nomFichier: string; message: string }
  | { type: 'conflit'; nomFichier: string; sauvegarde: FichierSauvegarde; existant: Projet | null }
  | { type: 'import'; nomFichier: string; nomChantier: string };

const TITRES: Record<Etape['type'], string> = {
  lecture: 'Importer un chantier',
  erreur: 'Import impossible',
  conflit: 'Ce chantier est déjà sur l’appareil',
  import: 'Import en cours',
};

function dateExport(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) +
    ' à ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function messageErreur(e: unknown): string {
  if (e instanceof ErreurSauvegarde) return e.message;
  console.error('Import impossible', e);
  return 'Import impossible : le fichier n’a pas pu être enregistré sur l’appareil.';
}

/**
 * Sélecteur de fichier caché et feuille de suivi de l'import. `choisirFichier`
 * ouvre le sélecteur ; `rendu` est à placer une fois dans l'écran.
 */
export function useImportChantier(): { choisirFichier: () => void; rendu: ReactNode } {
  const entree = useRef<HTMLInputElement>(null);
  const [etape, setEtape] = useState<Etape | null>(null);
  const occupe = etape?.type === 'lecture' || etape?.type === 'import';

  const choisirFichier = useCallback(() => entree.current?.click(), []);
  const fermer = useCallback(() => {
    if (!occupe) setEtape(null);
  }, [occupe]);

  const importer = async (s: FichierSauvegarde, mode: ModeImport, nomFichier: string) => {
    setEtape({ type: 'import', nomFichier, nomChantier: s.projet.nom });
    try {
      const p = await importerSauvegarde(s, mode);
      setEtape(null);
      const photos = s.photos.length > 0 ? ` avec ${pluriel(s.photos.length, 'photo')}` : '';
      notifier(`Chantier « ${p.nom} » importé${photos}`);
    } catch (e) {
      setEtape({ type: 'erreur', nomFichier, message: messageErreur(e) });
    }
  };

  const surFichier = async (e: ChangeEvent<HTMLInputElement>) => {
    const fichier = e.target.files?.[0];
    // Permet de rechoisir le même fichier ensuite.
    e.target.value = '';
    if (!fichier) return;
    setEtape({ type: 'lecture', nomFichier: fichier.name });
    try {
      const s = await lireFichierSauvegarde(fichier);
      if (await chantierExiste(s.projet.id)) {
        const existant = useEtat.getState().projets.find((p) => p.id === s.projet.id) ?? null;
        setEtape({ type: 'conflit', nomFichier: fichier.name, sauvegarde: s, existant });
      } else {
        await importer(s, 'nouveau', fichier.name);
      }
    } catch (err) {
      setEtape({ type: 'erreur', nomFichier: fichier.name, message: messageErreur(err) });
    }
  };

  let corps: ReactNode = null;
  let pied: ReactNode = null;
  if (etape?.type === 'lecture' || etape?.type === 'import') {
    corps = (
      <div className="accueil-import-attente" role="status">
        <span className="accueil-roue" aria-hidden="true" />
        {etape.type === 'lecture' ? `Lecture de « ${etape.nomFichier} »…` : `Enregistrement de « ${etape.nomChantier} » sur l’appareil…`}
      </div>
    );
  } else if (etape?.type === 'erreur') {
    corps = (
      <div className="accueil-import-erreur" role="alert">
        <Icone nom="alerte" taille={24} />
        <div>
          <p>{etape.message}</p>
          <p className="champ-aide">Fichier : {etape.nomFichier}</p>
        </div>
      </div>
    );
    pied = (
      <>
        <Bouton variante="contour" onClick={fermer}>
          Fermer
        </Bouton>
        <Bouton icone="dossier" onClick={choisirFichier}>
          Autre fichier
        </Bouton>
      </>
    );
  } else if (etape?.type === 'conflit') {
    const { sauvegarde: s, existant, nomFichier } = etape;
    corps = (
      <>
        <p className="accueil-import-texte">
          <strong>«&nbsp;{existant?.nom ?? s.projet.nom}&nbsp;»</strong> existe déjà sur cet appareil
          {existant ? ` (${formaterModification(existant.modifieLe).replace(/^Modifié/, 'modifié')})` : ''}. Le fichier a été
          exporté le {dateExport(s.exporteLe)}
          {s.photos.length > 0 ? `, avec ${pluriel(s.photos.length, 'photo')}` : ''}.
        </p>
        <div className="accueil-import-choix">
          <Bouton pleineLargeur icone="dupliquer" onClick={() => void importer(s, 'copie', nomFichier)}>
            Importer comme copie
          </Bouton>
          <p className="champ-aide">Les deux versions sont gardées : la copie porte la mention «&nbsp;(copie)&nbsp;».</p>
          <Bouton pleineLargeur variante="danger" icone="rotation" onClick={() => void importer(s, 'remplacer', nomFichier)}>
            Remplacer
          </Bouton>
          <p className="champ-aide">La version de cet appareil (plan, réglages et photos) est effacée et remplacée par celle du fichier.</p>
        </div>
      </>
    );
    pied = (
      <Bouton variante="contour" onClick={fermer}>
        Annuler
      </Bouton>
    );
  }

  const rendu = (
    <>
      <input
        ref={entree}
        type="file"
        accept={ACCEPT_IMPORT}
        className="visuellement-cache"
        tabIndex={-1}
        aria-hidden="true"
        data-role="import-chantier"
        onChange={(e) => void surFichier(e)}
      />
      <FeuilleBas ouverte={etape !== null} titre={etape ? TITRES[etape.type] : ''} onFermer={fermer} pied={pied}>
        {corps}
      </FeuilleBas>
    </>
  );
  return { choisirFichier, rendu };
}
