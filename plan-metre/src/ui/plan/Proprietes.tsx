// Panneau de propriétés de la sélection : feuille du bas (sans voile) sur
// téléphone, panneau latéral à droite à partir de 900 px de large.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { trouverTypeMur } from '../../geometrie/piece';
import { aire, longueurCote, perimetre } from '../../geometrie/polygone';
import { formaterValeur } from '../../metre/calcul';
import { MODELES_EQUIPEMENTS, MODELES_OUVERTURES, NOMS_PIECES } from '../../model/catalogue';
import type {
  Catalogue,
  Equipement,
  Ouverture,
  Photo,
  Piece,
  Plan,
  Projet,
  Selection,
  TypeEquipement,
  TypeOuverture,
} from '../../model/types';
import { planCourant, useEtat } from '../../store/etat';
import { urlImage } from '../../store/images';
import {
  Bouton,
  BoutonIcone,
  ChampNombre,
  ChampSelection,
  ChampTexte,
  FeuilleBas,
  Interrupteur,
  Segments,
  type OptionSelection,
} from '../commun/composants';
import { Icone } from '../commun/Icone';
import { naviguer } from '../routeur';
import {
  ajouterOuvertureAuMilieu,
  couperCote,
  dupliquer,
  modifierPiece,
  orthogonaliser,
  retirerSommet,
  supprimerPiece,
} from './actions';
import { bornerPosition, changerLongueurCote, changerTypeEquipement, changerTypeOuverture } from './operations';

const MUR_DEFAUT = '__defaut__';
const SANS_MUR = '__aucun__';

/** Libellés courts des types d'ouvertures (sous-barre de l'outil, panneau). */
export const LIBELLES_OUVERTURES: Record<TypeOuverture, string> = {
  porte: 'Porte',
  'porte-fenetre': 'Porte-fenêtre',
  fenetre: 'Fenêtre',
  baie: 'Baie',
  passage: 'Passage',
};

export const TYPES_OUVERTURES = Object.keys(LIBELLES_OUVERTURES) as TypeOuverture[];
export const TYPES_EQUIPEMENTS = Object.keys(MODELES_EQUIPEMENTS) as TypeEquipement[];

/** Préférence « garder les angles » conservée le temps de la session. */
let preferenceGarderAngles = true;

function cleSelection(s: Selection): string {
  switch (s.type) {
    case 'piece':
      return `piece-${s.pieceId}`;
    case 'sommet':
    case 'cote':
      return `${s.type}-${s.pieceId}-${s.index}`;
    case 'ouverture':
      return `ouverture-${s.ouvertureId}`;
    case 'equipement':
      return `equipement-${s.equipementId}`;
    case 'photo':
      return `photo-${s.photoId}`;
  }
}

function contenuSelection(
  s: Selection,
  plan: Plan,
  projet: Projet,
  photos: Photo[],
): { titre: string; corps: ReactNode } | null {
  if (s.type === 'photo') {
    const photo = photos.find((p) => p.id === s.photoId);
    return photo ? { titre: 'Photo', corps: <ApercuPhoto photo={photo} projetId={projet.id} /> } : null;
  }
  const piece = plan.pieces.find((p) => p.id === s.pieceId);
  if (!piece) return null;
  const nom = piece.nom || 'Sans nom';
  const cat = projet.catalogue;
  switch (s.type) {
    case 'piece':
      return { titre: nom, corps: <ProprietesPiece piece={piece} catalogue={cat} /> };
    case 'cote':
      if (!piece.sommets[s.index]) return null;
      return { titre: `Côté ${s.index + 1} · ${nom}`, corps: <ProprietesCote piece={piece} index={s.index} catalogue={cat} /> };
    case 'sommet':
      if (!piece.sommets[s.index]) return null;
      return { titre: `Sommet ${s.index + 1} · ${nom}`, corps: <ProprietesSommet piece={piece} index={s.index} /> };
    case 'ouverture': {
      const o = piece.ouvertures.find((x) => x.id === s.ouvertureId);
      return o ? { titre: `${LIBELLES_OUVERTURES[o.type]} · ${nom}`, corps: <ProprietesOuverture piece={piece} o={o} /> } : null;
    }
    case 'equipement': {
      const e = piece.equipements.find((x) => x.id === s.equipementId);
      return e ? { titre: e.nom || MODELES_EQUIPEMENTS[e.type].libelle, corps: <ProprietesEquipement piece={piece} e={e} /> } : null;
    }
  }
}

export function PanneauProprietes({ large }: { large: boolean }) {
  const projet = useEtat((e) => e.projet);
  const selection = useEtat((e) => e.selection);
  const plan = useEtat((e) => planCourant(e));
  const photos = useEtat((e) => e.photos);
  const fermer = useCallback(() => useEtat.getState().selectionner(null), []);
  if (!projet || !plan || !selection) return null;
  const contenu = contenuSelection(selection, plan, projet, photos);
  if (!contenu) return null;
  const corps = (
    <div className="plan2d-proprietes" key={cleSelection(selection)}>
      {contenu.corps}
    </div>
  );
  if (large) {
    return (
      <aside className="plan2d-panneau" aria-label={`Propriétés : ${contenu.titre}`}>
        <div className="plan2d-panneau-entete">
          <h2>{contenu.titre}</h2>
          <BoutonIcone icone="fermer" libelle="Fermer" onClick={fermer} />
        </div>
        <div className="plan2d-panneau-corps">{corps}</div>
      </aside>
    );
  }
  return (
    <FeuilleBas ouverte titre={contenu.titre} onFermer={fermer} sansVoile>
      {corps}
    </FeuilleBas>
  );
}

function ChampSegments<T extends string>({
  libelle,
  valeur,
  options,
  onChange,
}: {
  libelle: string;
  valeur: T;
  options: readonly OptionSelection<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="plan2d-champ-segments">
      <span className="champ-libelle">{libelle}</span>
      <Segments libelle={libelle} valeur={valeur} options={options} onChange={onChange} />
    </div>
  );
}

// ─── Pièce ───────────────────────────────────────────────────────────────

function ProprietesPiece({ piece, catalogue }: { piece: Piece; catalogue: Catalogue }) {
  const m = (fn: (p: Piece) => void, cle?: string) => modifierPiece(piece.id, fn, cle ? { cle } : undefined);
  const optionsMurs = catalogue.typesMurs.map((t) => ({ valeur: t.id, libelle: t.nom }));
  if (!catalogue.typesMurs.some((t) => t.id === piece.typeMurDefautId)) {
    optionsMurs.push({ valeur: piece.typeMurDefautId, libelle: 'Type de mur supprimé' });
  }
  return (
    <>
      <ChampTexte
        libelle="Nom"
        valeur={piece.nom}
        suggestions={NOMS_PIECES}
        onChange={(v) => m((p) => void (p.nom = v), `nom-piece-${piece.id}`)}
      />
      <ChampNombre
        libelle="Hauteur sous plafond"
        valeur={piece.hauteur}
        unite="cm"
        min={50}
        max={1000}
        decimales={1}
        onChange={(v) => m((p) => void (p.hauteur = v))}
      />
      <ChampSelection
        libelle="Revêtement de sol"
        valeur={piece.revetementSolId ?? ''}
        options={[{ valeur: '', libelle: 'Non renseigné' }, ...catalogue.revetementsSol.map((r) => ({ valeur: r.id, libelle: r.nom }))]}
        onChange={(v) => m((p) => void (p.revetementSolId = v || null))}
      />
      <ChampSelection
        libelle="Type de mur par défaut"
        valeur={piece.typeMurDefautId}
        options={optionsMurs}
        onChange={(v) => m((p) => void (p.typeMurDefautId = v))}
      />
      <Interrupteur libelle="Plafond à peindre" coche={piece.plafondAPeindre} onChange={(v) => m((p) => void (p.plafondAPeindre = v))} />
      <p className="plan2d-rappel">
        Surface <strong>{formaterValeur(aire(piece.sommets) / 1e4, 'm²')}</strong> · Périmètre{' '}
        <strong>{formaterValeur(perimetre(piece.sommets) / 100, 'm')}</strong>
      </p>
      <div className="plan2d-actions">
        <Bouton variante="contour" icone="dupliquer" onClick={() => dupliquer(piece.id)}>
          Dupliquer
        </Bouton>
        <Bouton variante="contour" icone="rectangle" onClick={() => orthogonaliser(piece.id)}>
          Orthogonaliser
        </Bouton>
        <Bouton variante="danger" icone="poubelle" onClick={() => void supprimerPiece(piece.id)}>
          Supprimer
        </Bouton>
      </div>
    </>
  );
}

// ─── Côté ────────────────────────────────────────────────────────────────

function ProprietesCote({ piece, index, catalogue }: { piece: Piece; index: number; catalogue: Catalogue }) {
  const [garderAngles, setGarderAngles] = useState(preferenceGarderAngles);
  const l = longueurCote(piece.sommets, index);
  const t = piece.sommets[index].typeMurId;
  const valeurMur = t === undefined ? MUR_DEFAUT : t === null ? SANS_MUR : t;
  const typeDefaut = trouverTypeMur(catalogue, piece.typeMurDefautId);
  const options: OptionSelection<string>[] = [
    { valeur: MUR_DEFAUT, libelle: 'Mur par défaut de la pièce' },
    ...catalogue.typesMurs.map((x) => ({ valeur: x.id, libelle: x.nom })),
    { valeur: SANS_MUR, libelle: 'Pas de mur (séparation fictive)' },
  ];
  if (t && !catalogue.typesMurs.some((x) => x.id === t)) options.push({ valeur: t, libelle: 'Type de mur supprimé' });
  return (
    <>
      <ChampNombre
        libelle="Longueur"
        valeur={Math.round(l * 10) / 10}
        unite="cm"
        min={1}
        max={100000}
        decimales={1}
        onChange={(v) => modifierPiece(piece.id, (p) => changerLongueurCote(p, index, v, garderAngles))}
      />
      <Interrupteur
        libelle="Garder les angles"
        aide="Le mur suivant se déplace en parallèle."
        coche={garderAngles}
        onChange={(v) => {
          preferenceGarderAngles = v;
          setGarderAngles(v);
        }}
      />
      <ChampSelection
        libelle="Mur"
        valeur={valeurMur}
        options={options}
        aide={valeurMur === MUR_DEFAUT ? (typeDefaut ? `Actuellement : ${typeDefaut.nom}` : 'Type de mur supprimé') : undefined}
        onChange={(v) =>
          modifierPiece(piece.id, (p) => {
            const s = p.sommets[index];
            if (v === MUR_DEFAUT) delete s.typeMurId;
            else s.typeMurId = v === SANS_MUR ? null : v;
          })
        }
      />
      <div className="plan2d-actions">
        <Bouton variante="secondaire" icone="porte" onClick={() => ajouterOuvertureAuMilieu(piece.id, index, 'porte')}>
          Ajouter une porte
        </Bouton>
        <Bouton variante="secondaire" icone="fenetre" onClick={() => ajouterOuvertureAuMilieu(piece.id, index, 'fenetre')}>
          Ajouter une fenêtre
        </Bouton>
        <Bouton variante="contour" icone="sommet" onClick={() => couperCote(piece.id, index)}>
          Couper le côté
        </Bouton>
      </div>
    </>
  );
}

// ─── Sommet ──────────────────────────────────────────────────────────────

function ProprietesSommet({ piece, index }: { piece: Piece; index: number }) {
  const minimum = piece.sommets.length <= 3;
  return (
    <>
      <p className="plan2d-rappel">
        Glissez la poignée pour déplacer le sommet : il s’aimante sur la grille, sur les angles des autres pièces et
        dans l’alignement des sommets voisins.
      </p>
      <Bouton variante="danger" icone="poubelle" disabled={minimum} onClick={() => retirerSommet(piece.id, index)}>
        Supprimer le sommet
      </Bouton>
      {minimum && <p className="plan2d-rappel" style={{ marginTop: 8 }}>Une pièce garde au moins 3 sommets.</p>}
    </>
  );
}

// ─── Ouverture ───────────────────────────────────────────────────────────

function ProprietesOuverture({ piece, o }: { piece: Piece; o: Ouverture }) {
  const l = longueurCote(piece.sommets, o.cote);
  const m = (fn: (x: Ouverture) => Ouverture | void) =>
    modifierPiece(piece.id, (p) => {
      const i = p.ouvertures.findIndex((x) => x.id === o.id);
      if (i < 0) return;
      const r = fn(p.ouvertures[i]);
      if (r) p.ouvertures[i] = r;
    });
  const porte = o.type === 'porte' || o.type === 'porte-fenetre';
  return (
    <>
      <ChampSelection
        libelle="Type"
        valeur={o.type}
        options={TYPES_OUVERTURES.map((t) => ({ valeur: t, libelle: MODELES_OUVERTURES[t].libelle }))}
        onChange={(t) => m((x) => changerTypeOuverture(x, t, l))}
      />
      <div className="ligne-champs">
        <ChampNombre
          libelle="Largeur"
          valeur={o.largeur}
          unite="cm"
          min={1}
          max={Math.max(1, Math.floor(l * 10) / 10)}
          decimales={1}
          onChange={(v) =>
            m((x) => {
              x.largeur = v;
              x.position = bornerPosition(x.position, v, l);
            })
          }
        />
        <ChampNombre libelle="Hauteur" valeur={o.hauteur} unite="cm" min={1} max={1000} decimales={1} onChange={(v) => m((x) => void (x.hauteur = v))} />
        <ChampNombre libelle="Allège" valeur={o.allege} unite="cm" min={0} max={1000} decimales={1} onChange={(v) => m((x) => void (x.allege = v))} />
      </div>
      <ChampNombre
        libelle="Position depuis le début du côté"
        valeur={o.position}
        unite="cm"
        min={0}
        max={Math.max(0, Math.floor((l - o.largeur) * 10) / 10)}
        decimales={1}
        aide={`Côté de ${Math.round(l)} cm`}
        onChange={(v) => m((x) => void (x.position = bornerPosition(v, x.largeur, l)))}
      />
      {porte && (
        <>
          <ChampSegments
            libelle="Charnière"
            valeur={o.charniere ?? 'debut'}
            options={[
              { valeur: 'debut', libelle: 'Au début' },
              { valeur: 'fin', libelle: 'À la fin' },
            ]}
            onChange={(v) => m((x) => void (x.charniere = v))}
          />
          <ChampSegments
            libelle="Sens d’ouverture"
            valeur={o.versInterieur === false ? 'exterieur' : 'interieur'}
            options={[
              { valeur: 'interieur', libelle: 'Vers l’intérieur' },
              { valeur: 'exterieur', libelle: 'Vers l’extérieur' },
            ]}
            onChange={(v) => m((x) => void (x.versInterieur = v === 'interieur'))}
          />
        </>
      )}
      <Bouton
        variante="danger"
        icone="poubelle"
        onClick={() => {
          modifierPiece(piece.id, (p) => void (p.ouvertures = p.ouvertures.filter((x) => x.id !== o.id)));
          useEtat.getState().selectionner({ type: 'cote', pieceId: piece.id, index: o.cote });
        }}
      >
        Supprimer l’ouverture
      </Bouton>
    </>
  );
}

// ─── Équipement ──────────────────────────────────────────────────────────

function ProprietesEquipement({ piece, e }: { piece: Piece; e: Equipement }) {
  const m = (fn: (x: Equipement) => Equipement | void, cle?: string) =>
    modifierPiece(
      piece.id,
      (p) => {
        const i = p.equipements.findIndex((x) => x.id === e.id);
        if (i < 0) return;
        const r = fn(p.equipements[i]);
        if (r) p.equipements[i] = r;
      },
      cle ? { cle } : undefined,
    );
  const tourner = (delta: number) => m((x) => void (x.rotation = (((x.rotation + delta) % 360) + 360) % 360));
  return (
    <>
      <ChampSelection
        libelle="Type"
        valeur={e.type}
        options={TYPES_EQUIPEMENTS.map((t) => ({ valeur: t, libelle: MODELES_EQUIPEMENTS[t].libelle }))}
        onChange={(t) => m((x) => changerTypeEquipement(x, t))}
      />
      <ChampTexte libelle="Nom" valeur={e.nom} onChange={(v) => m((x) => void (x.nom = v), `nom-equipement-${e.id}`)} />
      <div className="ligne-champs">
        <ChampNombre libelle="Largeur" valeur={e.largeur} unite="cm" min={1} max={2000} decimales={1} onChange={(v) => m((x) => void (x.largeur = v))} />
        <ChampNombre libelle="Profondeur" valeur={e.profondeur} unite="cm" min={1} max={2000} decimales={1} onChange={(v) => m((x) => void (x.profondeur = v))} />
        <ChampNombre libelle="Hauteur" valeur={e.hauteur} unite="cm" min={0} max={1000} decimales={1} onChange={(v) => m((x) => void (x.hauteur = v))} />
      </div>
      <div className="plan2d-rotation">
        <Bouton variante="contour" onClick={() => tourner(-90)} aria-label="Tourner de 90° vers la gauche">
          −90°
        </Bouton>
        <ChampNombre
          libelle="Rotation"
          valeur={e.rotation}
          unite="°"
          min={-360}
          max={360}
          decimales={1}
          onChange={(v) => m((x) => void (x.rotation = ((v % 360) + 360) % 360))}
        />
        <Bouton variante="contour" onClick={() => tourner(90)} aria-label="Tourner de 90° vers la droite">
          +90°
        </Bouton>
      </div>
      <Interrupteur
        libelle="Déduire du revêtement de sol"
        aide="L’emprise au sol est retirée de la surface de revêtement."
        coche={e.deduireSol}
        onChange={(v) => m((x) => void (x.deduireSol = v))}
      />
      <Bouton
        variante="danger"
        icone="poubelle"
        onClick={() => {
          modifierPiece(piece.id, (p) => void (p.equipements = p.equipements.filter((x) => x.id !== e.id)));
          useEtat.getState().selectionner({ type: 'piece', pieceId: piece.id });
        }}
      >
        Supprimer l’équipement
      </Bouton>
    </>
  );
}

// ─── Photo épinglée ──────────────────────────────────────────────────────

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function ApercuPhoto({ photo, projetId }: { photo: Photo; projetId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let actif = true;
    let creee: string | null = null;
    urlImage(photo.id, 'vignette')
      .then((u) => {
        if (!actif) {
          if (u) URL.revokeObjectURL(u);
          return;
        }
        creee = u;
        setUrl(u);
      })
      .catch((err) => console.error('Vignette illisible', err));
    return () => {
      actif = false;
      if (creee) URL.revokeObjectURL(creee);
    };
  }, [photo.id]);
  const date = new Date(photo.date);
  return (
    <>
      <div className="plan2d-photo-vignette">
        {url ? <img src={url} alt={photo.legende || 'Photo du chantier'} /> : <Icone nom="photo" taille={40} epaisseur={1.5} />}
      </div>
      {photo.legende && <p className="plan2d-photo-legende">{photo.legende}</p>}
      {!Number.isNaN(date.getTime()) && <p className="plan2d-rappel">{FORMAT_DATE.format(date)}</p>}
      <div className="plan2d-actions">
        <Bouton icone="photo" onClick={() => naviguer({ ecran: 'photos', id: projetId })}>
          Voir les photos
        </Bouton>
        <Bouton
          variante="contour"
          icone="epingle"
          onClick={async () => {
            await useEtat.getState().modifierPhoto(photo.id, { position: null });
            useEtat.getState().selectionner(null);
          }}
        >
          Retirer du plan
        </Bouton>
      </div>
    </>
  );
}
