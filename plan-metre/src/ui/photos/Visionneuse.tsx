// Visionneuse plein écran : image complète, légende, niveau et pièce
// modifiables, accès à l'épingle sur le plan, partage, suppression.
// Glisser à gauche / à droite (ou flèches du clavier) pour passer d'une photo à l'autre.

import { useCallback, useEffect, useRef, useState, type PointerEvent as EvenementPointeur } from 'react';
import { createPortal } from 'react-dom';
import type { ID, Photo, Projet, Variante } from '../../model/types';
import { useEtat } from '../../store/etat';
import { Bouton, BoutonIcone, ChampSelection, ChampTexte } from '../commun/composants';
import { confirmer, notifier } from '../commun/dialogues';
import { naviguer } from '../routeur';
import { attendreModifications, modifierPhotoEnSerie, partagerOuTelechargerPhoto, useUrlImage } from './images';
import { formaterDatePhoto, piecesDuNiveau } from './presentation';

const SEUIL_GLISSER = 60;
const DELAI_LEGENDE = 600;

export function Visionneuse({
  projet,
  photos,
  photoId,
  partage,
  onChanger,
  onFermer,
}: {
  projet: Projet;
  /** Photos dans l'ordre de la grille. */
  photos: readonly Photo[];
  photoId: ID;
  /** Le navigateur sait partager des fichiers (sinon : téléchargement). */
  partage: boolean;
  onChanger: (id: ID) => void;
  onFermer: () => void;
}) {
  const index = photos.findIndex((p) => p.id === photoId);
  const photo = index >= 0 ? photos[index] : null;
  const precedente = index > 0 ? photos[index - 1] : null;
  const suivante = index >= 0 && index < photos.length - 1 ? photos[index + 1] : null;
  const variante = useEtat((e) => e.variante);
  const urlVignette = useUrlImage(photo?.id ?? null, 'vignette');
  const urlComplete = useUrlImage(photo?.id ?? null, 'complete');
  const racine = useRef<HTMLDivElement>(null);
  const debutGlisser = useRef<{ x: number; y: number } | null>(null);

  // Focus dans la visionneuse à l'ouverture, rendu à l'élément d'origine à la fermeture.
  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    racine.current?.focus();
    return () => avant?.focus?.();
  }, []);

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      // Une confirmation est ouverte par-dessus : elle garde la main.
      if (document.querySelector('.dialogue')) return;
      const cible = e.target as HTMLElement | null;
      const enSaisie = !!cible && ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName);
      if (e.key === 'Escape') {
        e.preventDefault();
        onFermer();
      } else if (!enSaisie && e.key === 'ArrowLeft' && precedente) {
        onChanger(precedente.id);
      } else if (!enSaisie && e.key === 'ArrowRight' && suivante) {
        onChanger(suivante.id);
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onFermer, onChanger, precedente, suivante]);

  if (!photo) return null;

  const surPointeurBas = (e: EvenementPointeur) => {
    if (e.pointerType !== 'mouse') debutGlisser.current = { x: e.clientX, y: e.clientY };
  };
  const surPointeurHaut = (e: EvenementPointeur) => {
    const d = debutGlisser.current;
    debutGlisser.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) < SEUIL_GLISSER || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    if (dx < 0 && suivante) onChanger(suivante.id);
    if (dx > 0 && precedente) onChanger(precedente.id);
  };

  const supprimer = async () => {
    const ok = await confirmer({
      titre: 'Supprimer cette photo ?',
      message: 'La photo sera effacée de cet appareil et retirée du plan.',
      libelleConfirmer: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const apres = suivante ?? precedente;
    try {
      await attendreModifications();
      await useEtat.getState().supprimerPhoto(photo.id);
    } catch (e) {
      console.error('Suppression impossible', e);
      notifier('Suppression impossible, réessayez.', { erreur: true });
      return;
    }
    notifier('Photo supprimée');
    if (apres) onChanger(apres.id);
    else onFermer();
  };

  const url = urlComplete ?? urlVignette;
  return createPortal(
    <div
      ref={racine}
      className="photos-visionneuse"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} sur ${photos.length}`}
      tabIndex={-1}
    >
      <div className="photos-visionneuse-haut">
        <BoutonIcone icone="fermer" libelle="Fermer la photo" onClick={onFermer} />
        <span className="photos-visionneuse-compteur" aria-hidden="true">
          {index + 1} / {photos.length}
        </span>
      </div>
      <div className="photos-visionneuse-corps">
        <div
          className="photos-visionneuse-image"
          onPointerDown={surPointeurBas}
          onPointerUp={surPointeurHaut}
          onPointerCancel={() => (debutGlisser.current = null)}
        >
          {url ? (
            <img src={url} alt={photo.legende.trim() || 'Photo du chantier'} draggable={false} />
          ) : (
            <span className="photos-roue" role="status" aria-label="Chargement de la photo" />
          )}
          {precedente && (
            <BoutonIcone
              className="photos-visionneuse-nav precedente"
              icone="retour"
              libelle="Photo précédente"
              onClick={() => onChanger(precedente.id)}
            />
          )}
          {suivante && (
            <BoutonIcone
              className="photos-visionneuse-nav suivante"
              icone="suivant"
              libelle="Photo suivante"
              onClick={() => onChanger(suivante.id)}
            />
          )}
        </div>
        <PanneauPhoto
          key={photo.id}
          photo={photo}
          projet={projet}
          variante={variante}
          partage={partage}
          onSupprimer={() => void supprimer()}
        />
      </div>
    </div>,
    document.body,
  );
}

function PanneauPhoto({
  photo,
  projet,
  variante,
  partage,
  onSupprimer,
}: {
  photo: Photo;
  projet: Projet;
  variante: Variante;
  partage: boolean;
  onSupprimer: () => void;
}) {
  // Légende saisie localement, enregistrée après une pause de frappe et au départ de la photo.
  const [legende, setLegende] = useState(photo.legende);
  const enAttente = useRef<string | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enregistrerLegende = useCallback(() => {
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = null;
    const v = enAttente.current;
    enAttente.current = null;
    if (v !== null) void modifierPhotoEnSerie(photo.id, { legende: v });
  }, [photo.id]);

  useEffect(() => enregistrerLegende, [enregistrerLegende]);

  const changerLegende = (v: string) => {
    setLegende(v);
    enAttente.current = v;
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(enregistrerLegende, DELAI_LEGENDE);
  };

  const niveaux = [...projet.niveaux].sort((a, b) => a.ordre - b.ordre);
  const niveau = projet.niveaux.find((n) => n.id === photo.niveauId) ?? null;
  const pieces = niveau ? piecesDuNiveau(niveau, variante) : [];
  const pieceConnue = pieces.some((p) => p.id === photo.pieceId);

  const changerNiveau = (v: string) => {
    enregistrerLegende();
    // L'épingle et la pièce appartenaient au plan de l'ancien niveau.
    void modifierPhotoEnSerie(photo.id, { niveauId: v || null, pieceId: null, position: null });
  };
  const changerPiece = (v: string) => {
    enregistrerLegende();
    void modifierPhotoEnSerie(photo.id, { pieceId: v || null });
  };

  const voirSurLePlan = () => {
    enregistrerLegende();
    const etat = useEtat.getState();
    if (niveau) etat.choisirNiveau(niveau.id);
    etat.selectionner({ type: 'photo', photoId: photo.id });
    // Remplace l'entrée d'historique de la visionneuse : « retour » ramène aux photos.
    naviguer({ ecran: 'chantier', id: projet.id }, { remplacer: true });
  };

  const partager = () => {
    enregistrerLegende();
    void partagerOuTelechargerPhoto({ ...photo, legende }, projet.nom).catch((e) => {
      console.error('Partage impossible', e);
      notifier('Partage impossible.', { erreur: true });
    });
  };

  return (
    <div className="photos-panneau">
      <p className="photos-panneau-date">Photo du {formaterDatePhoto(photo.date)}</p>
      <ChampTexte
        libelle="Légende"
        valeur={legende}
        onChange={changerLegende}
        placeholder="Ex. : fissure au-dessus de la porte"
      />
      <div className="ligne-champs">
        <ChampSelection
          libelle="Niveau"
          valeur={niveau?.id ?? ''}
          onChange={changerNiveau}
          options={[...niveaux.map((n) => ({ valeur: n.id, libelle: n.nom })), { valeur: '', libelle: 'Sans niveau' }]}
        />
        <ChampSelection
          libelle="Pièce"
          valeur={pieceConnue ? (photo.pieceId as string) : ''}
          onChange={changerPiece}
          options={[{ valeur: '', libelle: 'Aucune pièce' }, ...pieces.map((p) => ({ valeur: p.id, libelle: p.nom || 'Pièce sans nom' }))]}
        />
      </div>
      <div className="photos-panneau-actions">
        {photo.position && niveau && (
          <Bouton variante="secondaire" icone="epingle" className="photos-voir-plan" onClick={voirSurLePlan}>
            Voir sur le plan
          </Bouton>
        )}
        <Bouton variante="contour" icone={partage ? 'partager' : 'telecharger'} onClick={partager}>
          {partage ? 'Partager' : 'Télécharger'}
        </Bouton>
        <Bouton variante="danger" icone="poubelle" onClick={onSupprimer}>
          Supprimer
        </Bouton>
      </div>
    </div>
  );
}
