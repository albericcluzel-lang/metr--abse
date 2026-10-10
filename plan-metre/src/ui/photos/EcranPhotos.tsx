// Photos du chantier : prise de vue ou import, rattachement au niveau et à la
// pièce, grille de vignettes groupées, visionneuse plein écran.

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { planDuNiveau } from '../../metre/calcul';
import type { ID, Photo, Projet, Variante } from '../../model/types';
import { niveauCourant, useEtat } from '../../store/etat';
import { ajouterPhotoDepuisFichier } from '../../store/images';
import { partageFichiersDisponible } from '../../store/sauvegarde';
import { pluriel } from '../accueil/presentation';
import { BarreHaut, Bouton, BoutonIcone, ChampSelection, EtatVide } from '../commun/composants';
import { notifier } from '../commun/dialogues';
import { Icone } from '../commun/Icone';
import { naviguer } from '../routeur';
import { useProjetOuvert } from '../useProjetOuvert';
import { useUrlImage } from './images';
import { libellePhoto, ordreAffichage, regrouperPhotos, texteProgression } from './presentation';
import { Visionneuse } from './Visionneuse';
import './photos.css';

export function EcranPhotos({ id }: { id: string }) {
  const projet = useProjetOuvert(id);
  const photos = useEtat((e) => e.photos);
  const variante = useEtat((e) => e.variante);
  const [ouverteId, setOuverteId] = useState<ID | null>(null);
  const partage = useMemo(() => partageFichiersDisponible(), []);

  const groupes = useMemo(() => (projet ? regrouperPhotos(photos, projet, variante) : []), [photos, projet, variante]);
  const ordre = useMemo(() => ordreAffichage(groupes), [groupes]);

  // Photo supprimée ou déplacée ailleurs : la visionneuse se ferme.
  useEffect(() => {
    if (ouverteId && !ordre.some((p) => p.id === ouverteId)) setOuverteId(null);
  }, [ordre, ouverteId]);

  // Le bouton « retour » d'Android ferme la visionneuse au lieu de quitter l'écran.
  const visionneuseOuverte = ouverteId !== null;
  useEffect(() => {
    if (!visionneuseOuverte) return;
    history.pushState({ abseVisionneuse: true }, '');
    let fermeeParRetour = false;
    const surRetour = () => {
      fermeeParRetour = true;
      setOuverteId(null);
    };
    window.addEventListener('popstate', surRetour);
    return () => {
      window.removeEventListener('popstate', surRetour);
      if (!fermeeParRetour && (history.state as { abseVisionneuse?: boolean } | null)?.abseVisionneuse) history.back();
    };
  }, [visionneuseOuverte]);

  if (!projet) return <div className="chargement">Chargement du chantier…</div>;

  return (
    <div className="ecran">
      <BarreHaut
        titre="Photos"
        sousTitre={projet.nom}
        onRetour={() => naviguer({ ecran: 'chantier', id })}
        libelleRetour="Retour au plan"
      />
      <main className="ecran-contenu etroit photos-contenu">
        <AjoutPhotos key={projet.id} projet={projet} variante={variante} />

        {groupes.length === 0 ? (
          <EtatVide icone="photo" titre="Aucune photo pour ce chantier">
            <p className="photos-vide-texte">
              Photographiez l’existant (fissures, réseaux, menuiseries…) : chaque photo est rattachée au niveau et à la
              pièce choisis ci-dessus, et reste sur l’appareil.
            </p>
          </EtatVide>
        ) : (
          groupes.map((g) => (
            <section key={g.cle} className="photos-groupe" aria-label={`${g.titre}, ${pluriel(g.nombre, 'photo')}`}>
              <h2 className="photos-groupe-titre">
                {g.titre}
                <span className="photos-compte">{pluriel(g.nombre, 'photo')}</span>
              </h2>
              {g.pieces.map((s) => (
                <div key={s.cle} className="photos-sous-groupe">
                  {s.titre && (
                    <h3 className="photos-sous-titre">
                      {s.titre} <span className="photos-compte">· {s.photos.length}</span>
                    </h3>
                  )}
                  <ul className="photos-grille">
                    {s.photos.map((p) => (
                      <li key={p.id}>
                        <Vignette photo={p} onOuvrir={() => setOuverteId(p.id)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))
        )}
      </main>

      {ouverteId && (
        <Visionneuse
          projet={projet}
          photos={ordre}
          photoId={ouverteId}
          partage={partage}
          onChanger={setOuverteId}
          onFermer={() => setOuverteId(null)}
        />
      )}
    </div>
  );
}

function Vignette({ photo, onOuvrir }: { photo: Photo; onOuvrir: () => void }) {
  const url = useUrlImage(photo.id, 'vignette');
  const legende = photo.legende.trim();
  return (
    <button type="button" className="photos-vignette" onClick={onOuvrir} aria-label={libellePhoto(photo)} data-photo={photo.id}>
      {url ? <img src={url} alt="" decoding="async" draggable={false} /> : <span className="photos-vignette-attente" />}
      {photo.position && (
        <span className="photos-vignette-epingle" title="Placée sur le plan">
          <Icone nom="epingle" taille={14} />
        </span>
      )}
      {legende && <span className="photos-vignette-legende">{legende}</span>}
    </button>
  );
}

// ─── Ajout de photos ───────────────────────────────────────────────────────

function selectionInitiale(): ID | null {
  const s = useEtat.getState().selection;
  return s && s.type !== 'photo' ? s.pieceId : null;
}

function AjoutPhotos({ projet, variante }: { projet: Projet; variante: Variante }) {
  const niveaux = [...projet.niveaux].sort((a, b) => a.ordre - b.ordre);
  // Par défaut : le niveau affiché sur le plan, et la pièce sélectionnée s'il y en a une.
  const [niveauId, setNiveauId] = useState<ID>(() => niveauCourant(useEtat.getState())?.id ?? niveaux[0]?.id ?? '');
  const [pieceId, setPieceId] = useState<ID | null>(selectionInitiale);
  const [progression, setProgression] = useState<{ fait: number; total: number } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const galerie = useRef<HTMLInputElement>(null);
  const monte = useRef(true);

  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  const niveau = projet.niveaux.find((n) => n.id === niveauId) ?? niveaux[0] ?? null;
  const pieces = niveau ? planDuNiveau(niveau, variante).pieces : [];
  const piece = pieces.find((p) => p.id === pieceId) ?? null;

  const ajouter = async (e: ChangeEvent<HTMLInputElement>) => {
    const fichiers = Array.from(e.target.files ?? []);
    // Permet de reprendre la même photo ou de rechoisir les mêmes fichiers.
    e.target.value = '';
    if (fichiers.length === 0 || progression) return;
    setErreur(null);
    const contexte = { niveauId: niveau?.id ?? null, pieceId: piece?.id ?? null };
    let reussies = 0;
    const echecs: string[] = [];
    for (let i = 0; i < fichiers.length; i++) {
      // Écran quitté ou autre chantier ouvert entre-temps : on s'arrête.
      if (!monte.current || useEtat.getState().projet?.id !== projet.id) break;
      setProgression({ fait: i, total: fichiers.length });
      try {
        await ajouterPhotoDepuisFichier(fichiers[i], contexte);
        reussies++;
      } catch (err) {
        console.error('Photo illisible', fichiers[i].name, err);
        echecs.push(fichiers[i].name);
      }
    }
    if (!monte.current) return;
    setProgression(null);
    if (echecs.length > 0) {
      setErreur(
        `${echecs.length === 1 ? `« ${echecs[0]} » n’a pas pu être ajoutée` : `${echecs.length} photos n’ont pas pu être ajoutées`} : format d’image non pris en charge (HEIC, RAW…) ou fichier abîmé.`,
      );
    }
    if (reussies > 0) notifier(reussies === 1 ? 'Photo ajoutée' : `${reussies} photos ajoutées`);
  };

  const occupe = progression !== null;
  return (
    <section className="photos-ajout" aria-label="Ajouter des photos">
      <div className="photos-ajout-boutons">
        <Bouton icone="photo" disabled={occupe} onClick={() => camera.current?.click()}>
          Prendre une photo
        </Bouton>
        <Bouton variante="contour" icone="televerser" disabled={occupe} onClick={() => galerie.current?.click()}>
          Importer
        </Bouton>
      </div>
      <p className="photos-ajout-consigne">Rattacher les nouvelles photos à :</p>
      <div className="ligne-champs">
        <ChampSelection
          libelle="Niveau"
          valeur={niveau?.id ?? ''}
          onChange={(v) => {
            setNiveauId(v);
            setPieceId(null);
          }}
          options={niveaux.map((n) => ({ valeur: n.id, libelle: n.nom }))}
        />
        <ChampSelection
          libelle="Pièce (facultatif)"
          valeur={piece?.id ?? ''}
          onChange={(v) => setPieceId(v || null)}
          options={[{ valeur: '', libelle: 'Aucune pièce' }, ...pieces.map((p) => ({ valeur: p.id, libelle: p.nom || 'Pièce sans nom' }))]}
        />
      </div>

      {progression && (
        <div className="photos-progression" role="status">
          <span className="photos-roue petite" aria-hidden="true" />
          <span className="photos-progression-texte">{texteProgression(progression.fait, progression.total)}</span>
          <span className="photos-barre" aria-hidden="true">
            <span style={{ width: `${Math.round((progression.fait / progression.total) * 100)}%` }} />
          </span>
        </div>
      )}
      {erreur && (
        <div className="photos-erreur" role="alert">
          <Icone nom="alerte" taille={20} />
          <p>{erreur}</p>
          <BoutonIcone icone="fermer" libelle="Masquer le message" onClick={() => setErreur(null)} />
        </div>
      )}

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="visuellement-cache"
        tabIndex={-1}
        aria-hidden="true"
        data-role="photo-camera"
        onChange={(e) => void ajouter(e)}
      />
      <input
        ref={galerie}
        type="file"
        accept="image/*"
        multiple
        className="visuellement-cache"
        tabIndex={-1}
        aria-hidden="true"
        data-role="photo-import"
        onChange={(e) => void ajouter(e)}
      />
    </section>
  );
}
