// Réglages : niveaux du chantier (nom, hauteur par défaut, ordre, suppression,
// suppression du plan rénové) et ajout d'un niveau.

import { useEffect, useId, useState, type FormEvent } from 'react';
import { nouveauNiveau } from '../../model/fabrique';
import type { Niveau, Projet } from '../../model/types';
import { niveauCourant, useEtat } from '../../store/etat';
import { pluriel } from '../accueil/presentation';
import { Bouton, BoutonIcone, ChampNombre, ChampTexte, FeuilleBas } from '../commun/composants';
import { confirmer, notifier } from '../commun/dialogues';
import { modifierChantier, TexteObligatoire } from './champs';
import { ajouterNiveau, deplacerNiveau, niveauxTries, supprimerNiveau } from './operations';

const NOMS_NIVEAUX = ['Sous-sol', 'RDC', 'R+1', 'R+2', 'R+3', 'Combles', 'Mezzanine'];

function nombrePieces(n: Niveau): number {
  return new Set([...n.actuel.pieces, ...(n.renove?.pieces ?? [])].map((p) => p.id)).size;
}

export function SectionNiveaux({ projet }: { projet: Projet }) {
  const photos = useEtat((e) => e.photos);
  const [ajout, setAjout] = useState(false);
  // Du plus haut au plus bas, comme dans le bâtiment.
  const niveaux = niveauxTries(projet).reverse();
  const seul = niveaux.length <= 1;

  return (
    <section aria-labelledby="reglages-titre-niveaux">
      <h2 id="reglages-titre-niveaux" className="titre-section">
        Niveaux
      </h2>
      <ul className="reglages-niveaux">
        {niveaux.map((n, i) => (
          <LigneNiveau
            key={n.id}
            niveau={n}
            enHaut={i === 0}
            enBas={i === niveaux.length - 1}
            seul={seul}
            nombrePhotos={photos.filter((p) => p.niveauId === n.id).length}
          />
        ))}
      </ul>
      {seul && <p className="reglages-note">Un chantier garde toujours au moins un niveau.</p>}
      <Bouton variante="secondaire" icone="plus" className="reglages-ajouter" onClick={() => setAjout(true)}>
        Ajouter un niveau
      </Bouton>
      <FeuilleAjoutNiveau ouverte={ajout} projet={projet} onFermer={() => setAjout(false)} />
    </section>
  );
}

function LigneNiveau({
  niveau,
  enHaut,
  enBas,
  seul,
  nombrePhotos,
}: {
  niveau: Niveau;
  enHaut: boolean;
  enBas: boolean;
  seul: boolean;
  nombrePhotos: number;
}) {
  const id = niveau.id;
  const trouver = (p: Projet) => p.niveaux.find((n) => n.id === id);
  const detail = [
    pluriel(niveau.actuel.pieces.length, 'pièce'),
    niveau.renove ? `rénové : ${pluriel(niveau.renove.pieces.length, 'pièce')}` : null,
    nombrePhotos > 0 ? pluriel(nombrePhotos, 'photo') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const supprimer = async () => {
    const pieces = nombrePieces(niveau);
    const morceaux = [
      pieces > 0
        ? `${pieces === 1 ? 'Sa pièce' : `Ses ${pieces} pièces`} (plan actuel${niveau.renove ? ' et plan rénové' : ''}) ${pieces === 1 ? 'sera supprimée' : 'seront supprimées'}.`
        : 'Ce niveau ne contient aucune pièce.',
      nombrePhotos > 0 ? `${nombrePhotos === 1 ? 'Sa photo est gardée' : `Ses ${nombrePhotos} photos sont gardées`}, sans niveau.` : '',
    ];
    const ok = await confirmer({
      titre: `Supprimer le niveau « ${niveau.nom} » ?`,
      message: morceaux.filter(Boolean).join(' '),
      libelleConfirmer: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const etat = useEtat.getState();
    const photosDuNiveau = etat.photos.filter((p) => p.niveauId === id);
    modifierChantier((p) => void supprimerNiveau(p, id));
    const apres = useEtat.getState();
    if (apres.niveauId === id && apres.projet) apres.choisirNiveau(niveauxTries(apres.projet)[0].id);
    try {
      // La pièce et l'épingle appartenaient au plan du niveau supprimé.
      for (const photo of photosDuNiveau) {
        await useEtat.getState().modifierPhoto(photo.id, { niveauId: null, pieceId: null, position: null });
      }
    } catch (e) {
      console.error('Photos non détachées', e);
      notifier('Certaines photos n’ont pas pu être détachées du niveau.', { erreur: true });
      return;
    }
    notifier(`Niveau « ${niveau.nom} » supprimé`);
  };

  const supprimerRenove = async () => {
    const ok = await confirmer({
      titre: `Supprimer le plan rénové du niveau « ${niveau.nom} » ?`,
      message: 'Le plan actuel est conservé. Le plan rénové pourra être recréé à partir de lui.',
      libelleConfirmer: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    modifierChantier((p) => {
      const n = trouver(p);
      if (n) n.renove = null;
    });
    // Sinon, la prochaine modification du plan recréerait aussitôt un plan rénové.
    const etat = useEtat.getState();
    if (etat.variante === 'renove' && niveauCourant(etat)?.id === id) etat.choisirVariante('actuel');
    notifier('Plan rénové supprimé');
  };

  return (
    <li className="reglages-niveau carte">
      <div className="reglages-niveau-champs">
        <TexteObligatoire
          libelle="Nom du niveau"
          valeur={niveau.nom}
          messageVide="Le niveau doit garder un nom."
          onChange={(v) =>
            modifierChantier((p) => {
              const n = trouver(p);
              if (n) n.nom = v;
            }, `niveau:${id}:nom`)
          }
        />
        <ChampNombre
          libelle="Hauteur par défaut"
          unite="cm"
          decimales={0}
          min={50}
          max={1000}
          valeur={niveau.hauteurDefaut}
          onChange={(v) =>
            modifierChantier((p) => {
              const n = trouver(p);
              if (n) n.hauteurDefaut = v;
            })
          }
        />
      </div>
      <div className="reglages-niveau-pied">
        <span className="reglages-detail">{detail}</span>
        <BoutonIcone
          icone="bas"
          className="reglages-monter"
          libelle={`Monter « ${niveau.nom} »`}
          disabled={enHaut}
          onClick={() => modifierChantier((p) => void deplacerNiveau(p, id, 1))}
        />
        <BoutonIcone
          icone="bas"
          libelle={`Descendre « ${niveau.nom} »`}
          disabled={enBas}
          onClick={() => modifierChantier((p) => void deplacerNiveau(p, id, -1))}
        />
        <BoutonIcone
          icone="poubelle"
          libelle={`Supprimer le niveau « ${niveau.nom} »`}
          disabled={seul}
          onClick={() => void supprimer()}
        />
      </div>
      {niveau.renove && (
        <Bouton variante="fantome" icone="poubelle" className="reglages-supprimer-renove" onClick={() => void supprimerRenove()}>
          Supprimer le plan rénové
        </Bouton>
      )}
    </li>
  );
}

function FeuilleAjoutNiveau({ ouverte, projet, onFermer }: { ouverte: boolean; projet: Projet; onFermer: () => void }) {
  const [nom, setNom] = useState('');
  const [hauteur, setHauteur] = useState(250);
  useEffect(() => {
    if (!ouverte) return;
    const existants = new Set(projet.niveaux.map((n) => n.nom));
    setNom(NOMS_NIVEAUX.find((n) => !existants.has(n) && n !== 'Sous-sol') ?? `Niveau ${projet.niveaux.length + 1}`);
    // Même hauteur que le niveau le plus haut, pour aller vite.
    setHauteur(niveauxTries(projet).at(-1)?.hauteurDefaut ?? 250);
    // Valeurs proposées à l'ouverture seulement (pas à chaque modification du chantier).
  }, [ouverte]);

  const idFormulaire = useId();
  const valider = (e: FormEvent) => {
    e.preventDefault();
    const propre = nom.trim() || `Niveau ${projet.niveaux.length + 1}`;
    modifierChantier((p) => ajouterNiveau(p, nouveauNiveau(propre, 0, hauteur)));
    notifier(`Niveau « ${propre} » ajouté`);
    onFermer();
  };

  return (
    <FeuilleBas
      ouverte={ouverte}
      titre="Nouveau niveau"
      onFermer={onFermer}
      pied={
        <>
          <Bouton variante="contour" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton type="submit" form={idFormulaire}>
            Ajouter
          </Bouton>
        </>
      }
    >
      <form id={idFormulaire} onSubmit={valider} noValidate>
        <ChampTexte libelle="Nom du niveau" valeur={nom} onChange={setNom} suggestions={NOMS_NIVEAUX} autoFocus />
        <ChampNombre
        libelle="Hauteur sous plafond par défaut"
        valeur={hauteur}
        onChange={setHauteur}
        unite="cm"
        min={50}
        max={1000}
        decimales={0}
        aide="« Sous-sol » se place sous les autres niveaux ; les autres s’ajoutent au-dessus."
        />
      </form>
    </FeuilleBas>
  );
}
