// Relevé en réalité augmentée : écran d'accueil (avant la session) puis
// interface en surimpression (« dom-overlay ») pendant la session WebXR.
//
// Pendant la session, seul l'élément racine de cet écran est visible par-dessus
// la caméra : les messages s'affichent donc ici (pas de dialogue ni de
// notification globale, qui resteraient invisibles).

import { useEffect, useReducer, useRef, useState } from 'react';
import { nouvelId } from '../../model/fabrique';
import { formaterValeur } from '../../metre/calcul';
import { BarreHaut, Bouton, ChampNombre } from '../commun/composants';
import { Icone } from '../commun/Icone';
import { IconeReleve } from './IconeReleve';
import {
  aireAnglesM2,
  cloturerSession,
  etatInitialRA,
  infosVisee,
  messageErreurRA,
  problemeFermeture,
  reduireRA,
  type EtatRA,
  type Point3,
} from './releveRA';
import { SessionRA, type Visee } from './sessionRA';
import { zonesDepuisRA, type ZoneRelevee } from './zones';

const AUCUNE_SURFACE = 'Aucune surface visée : balayez lentement le sol jusqu’à voir le réticule.';
const DUREE_MESSAGE_MS = 4500;

function pluriel(n: number, mot: string): string {
  return `${n} ${mot}${n > 1 ? 's' : ''}`;
}

function consigne(etat: EtatRA, visee: Visee): { titre: string; texte: string } {
  const n = etat.angles.length;
  switch (etat.etape) {
    case 'angles':
      if (!visee.point) return { titre: `Angle ${n + 1}`, texte: 'Balayez lentement le sol avec le téléphone jusqu’à voir le réticule.' };
      if (n === 0) {
        return { titre: 'Angle 1', texte: 'Visez le sol au pied d’un mur, dans un angle, puis touchez Placer un angle.' };
      }
      return {
        titre: `Angle ${n + 1}`,
        texte:
          n >= 3
            ? 'Angle suivant, ou revenez au premier angle (il passe au vert) pour fermer la pièce.'
            : 'Suivez les murs dans le sens des aiguilles d’une montre et visez l’angle suivant au pied du mur.',
      };
    case 'hauteur':
      return { titre: 'Hauteur sous plafond', texte: 'Visez la jonction mur / plafond puis touchez Mesurer la hauteur.' };
    case 'zone-terminee':
      return {
        titre: `Zone ${etat.zones.length} terminée`,
        texte: 'Relevez une autre pièce sans quitter : elle gardera sa position par rapport aux précédentes.',
      };
  }
}

export function EcranRA({
  hauteurDefaut,
  onTerminer,
  onRetour,
}: {
  hauteurDefaut: number;
  /** Fin de session avec au moins une zone ; `message` à afficher ensuite. */
  onTerminer: (zones: ZoneRelevee[], message: string | null) => void;
  onRetour: () => void;
}) {
  const racine = useRef<HTMLDivElement>(null);
  const [etat, envoyer] = useReducer(reduireRA, undefined, etatInitialRA);
  const etatRef = useRef(etat);
  const sessionRef = useRef<SessionRA | null>(null);
  const idSession = useRef(nouvelId());
  const monte = useRef(false);
  const props = useRef({ hauteurDefaut, onTerminer });
  const [enSession, setEnSession] = useState(false);
  const [demarrage, setDemarrage] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [visee, setVisee] = useState<Visee>({ point: null, suivi: true, estime: false });
  const [visible, setVisible] = useState(true);
  const [saisieHauteur, setSaisieHauteur] = useState(false);
  const [hauteurSaisie, setHauteurSaisie] = useState(hauteurDefaut);
  const [confirmerQuitter, setConfirmerQuitter] = useState(false);

  useEffect(() => {
    props.current = { hauteurDefaut, onTerminer };
  });

  useEffect(() => {
    etatRef.current = etat;
    sessionRef.current?.dessiner(etat);
  }, [etat]);

  // Quitter l'écran pendant une session : on la termine proprement.
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
      const s = sessionRef.current;
      sessionRef.current = null;
      void s?.terminer();
    };
  }, []);

  useEffect(() => {
    if (!etat.message) return;
    const t = setTimeout(() => envoyer({ type: 'effacer-message' }), DUREE_MESSAGE_MS);
    return () => clearTimeout(t);
  }, [etat.message]);

  useEffect(() => setConfirmerQuitter(false), [etat.angles, etat.etape]);

  const surFinSession = (interrompue: boolean) => {
    sessionRef.current = null;
    if (!monte.current) return;
    setEnSession(false);
    setSaisieHauteur(false);
    setVisible(true);
    const e = etatRef.current;
    const bilan = cloturerSession(e, props.current.hauteurDefaut);
    const zones = zonesDepuisRA(bilan.zones, idSession.current);
    const details: string[] = [];
    if (interrompue) details.push('La session de réalité augmentée s’est interrompue.');
    if (bilan.zoneEnCoursConservee) {
      details.push(
        e.hauteur !== null
          ? 'La pièce en cours a été gardée avec les angles déjà placés.'
          : `La pièce en cours a été gardée avec les angles déjà placés (hauteur par défaut ${props.current.hauteurDefaut} cm, à vérifier).`,
      );
    }
    if (bilan.anglesPerdus > 0) {
      details.push(`${pluriel(bilan.anglesPerdus, 'angle')} de la pièce en cours n’ont pas pu être gardés (pièce incomplète).`);
    }
    // Une nouvelle session aura un autre repère.
    envoyer({ type: 'reinitialiser' });
    idSession.current = nouvelId();
    if (zones.length > 0) props.current.onTerminer(zones, details.join(' ') || null);
    else if (details.length > 0) setErreur(details.join(' '));
  };

  const surToucherEcran = (point: Point3 | null) => {
    const e = etatRef.current;
    // Sans surimpression (non accordée), les touchers suffisent à tout le relevé.
    const surimpression = sessionRef.current?.avecSurimpression ?? true;
    if (e.etape === 'angles') {
      envoyer(point ? { type: 'placer-angle', point } : { type: 'signaler', message: AUCUNE_SURFACE });
    } else if (e.etape === 'hauteur') {
      if (!surimpression && e.hauteur !== null) envoyer({ type: 'terminer-zone' });
      else if (point) envoyer({ type: 'mesurer-hauteur', point });
    } else if (!surimpression) {
      envoyer({ type: 'nouvelle-zone' });
    }
  };

  const demarrer = () => {
    const el = racine.current;
    if (!el || demarrage || sessionRef.current) return;
    setErreur(null);
    setDemarrage(true);
    // Appel direct depuis le toucher : le navigateur exige un geste de l'utilisateur.
    SessionRA.demarrer(el, {
      surVisee: setVisee,
      surSelection: surToucherEcran,
      surAjustement: (corrections) => envoyer({ type: 'ajuster-angles', corrections }),
      surFin: surFinSession,
      surVisibilite: setVisible,
    })
      .then((s) => {
        if (!monte.current) {
          void s.terminer();
          return;
        }
        sessionRef.current = s;
        s.dessiner(etatRef.current);
        setEnSession(true);
      })
      .catch((e: unknown) => {
        if (monte.current) setErreur(messageErreurRA(e));
      })
      .finally(() => {
        if (monte.current) setDemarrage(false);
      });
  };

  const viser = (): Point3 | null => {
    const p = sessionRef.current?.visee ?? null;
    if (!p) envoyer({ type: 'signaler', message: AUCUNE_SURFACE });
    return p;
  };

  const placerAngle = () => {
    const p = viser();
    if (p) envoyer({ type: 'placer-angle', point: p });
  };

  const mesurerHauteur = () => {
    const p = viser();
    if (p) envoyer({ type: 'mesurer-hauteur', point: p });
  };

  const quitter = () => {
    const e = etatRef.current;
    const perdus = e.etape !== 'zone-terminee' && e.angles.length > 0 && problemeFermeture(e.angles) !== null;
    if (perdus && !confirmerQuitter) {
      setConfirmerQuitter(true);
      envoyer({
        type: 'signaler',
        message: `La pièce en cours est incomplète : ses ${pluriel(e.angles.length, 'angle')} seront perdus. Touchez encore Quitter pour confirmer.`,
      });
      return;
    }
    const s = sessionRef.current;
    if (s) void s.terminer();
  };

  const ouvrirSaisieHauteur = () => {
    setHauteurSaisie(etat.hauteur ?? hauteurDefaut);
    setSaisieHauteur(true);
  };

  const validerSaisieHauteur = () => {
    envoyer({ type: 'saisir-hauteur', hauteur: hauteurSaisie });
    setSaisieHauteur(false);
  };

  const infos = infosVisee(etat, visee.point);
  const { titre, texte } = consigne(etat, visee);
  const derniereZone = etat.zones[etat.zones.length - 1];

  return (
    <div ref={racine} className={`releve-ra${enSession ? ' en-session' : ''}`}>
      {!enSession ? (
        <div className="ecran">
          <BarreHaut titre="Réalité augmentée" onRetour={onRetour} />
          <div className="ecran-contenu etroit">
            {erreur && (
              <div className="releve-erreur" role="alert">
                <Icone nom="alerte" taille={20} />
                <span>{erreur}</span>
              </div>
            )}
            <ol className="releve-etapes">
              <li>
                <strong>Repérez le sol.</strong> Tenez le téléphone devant vous et balayez lentement le sol jusqu’à voir le réticule.
              </li>
              <li>
                <strong>Placez les angles.</strong> Visez le sol au pied d’un mur, dans un angle, puis touchez « Placer un angle ».
                Faites le tour de la pièce dans le sens des aiguilles d’une montre.
              </li>
              <li>
                <strong>Fermez la pièce</strong> en revenant au premier angle (il passe au vert) ou avec « Fermer la pièce ».
              </li>
              <li>
                <strong>Mesurez la hauteur</strong> en visant la jonction mur / plafond, ou saisissez-la.
              </li>
            </ol>
            <p className="releve-astuce">
              <Icone nom="info" taille={18} />
              <span>
                Les pièces relevées dans la même session gardent leur position les unes par rapport aux autres. Un bon éclairage et
                un sol dégagé facilitent la visée.
              </span>
            </p>
          </div>
          <div className="releve-pied">
            <Bouton pleineLargeur onClick={demarrer} disabled={demarrage}>
              <IconeReleve nom="realite-augmentee" taille={20} />
              {demarrage ? 'Démarrage…' : 'Démarrer la réalité augmentée'}
            </Bouton>
          </div>
        </div>
      ) : (
        <>
          <div className="releve-ra-zone-haut">
            <div className="releve-ra-haut" data-ra-panneau="">
              <div className="releve-ra-consigne" aria-live="polite">
                <strong>{titre}</strong>
                <span>{texte}</span>
              </div>
              <button type="button" className="releve-ra-quitter" onClick={quitter}>
                <IconeReleve nom="quitter" taille={18} />
                Quitter
              </button>
            </div>
            {(!visee.suivi || !visible) && (
              <div className="releve-ra-alerte" role="status">
                {!visible ? 'Session en pause.' : 'Suivi perdu : bougez lentement le téléphone et éclairez la pièce.'}
              </div>
            )}
            {etat.message && (
              <div className="releve-ra-message" role="alert">
                {etat.message}
              </div>
            )}
          </div>

          <div className={`releve-ra-viseur${infos.procheDuPremier ? ' proche' : ''}`} aria-hidden="true" />

          {etat.etape === 'angles' && infos.distanceDernier !== null && (
            <div className="releve-ra-mesure">
              {formaterValeur(infos.distanceDernier / 100, 'm')}
              <span>depuis le dernier angle{visee.estime ? ' (estimé)' : ''}</span>
            </div>
          )}
          {etat.etape === 'hauteur' && infos.hauteur !== null && (
            <div className="releve-ra-mesure">
              {infos.hauteur} cm<span>hauteur visée</span>
            </div>
          )}

          <div className="releve-ra-bas" data-ra-panneau="">
            {etat.etape === 'angles' && (
              <>
                <p className="releve-ra-statut">
                  {etat.angles.length === 0
                    ? 'Aucun angle placé'
                    : `${pluriel(etat.angles.length, 'angle')}${
                        etat.angles.length >= 3 ? ` · ${formaterValeur(aireAnglesM2(etat.angles), 'm²')}` : ''
                      }`}
                </p>
                <div className="releve-ra-rangee">
                  <button
                    type="button"
                    className="releve-ra-secondaire"
                    disabled={etat.angles.length === 0}
                    onClick={() => envoyer({ type: 'annuler-angle' })}
                  >
                    <Icone nom="annuler" taille={22} />
                    Annuler le dernier angle
                  </button>
                  <button type="button" className="releve-ra-principal" onClick={placerAngle}>
                    <IconeReleve nom="angle" taille={30} />
                    Placer un angle
                  </button>
                  <button
                    type="button"
                    className={`releve-ra-secondaire releve-ra-fermer${infos.procheDuPremier ? ' proche' : ''}`}
                    disabled={!infos.peutFermer}
                    onClick={() => envoyer({ type: 'fermer' })}
                  >
                    <Icone nom="valider" taille={22} />
                    Fermer la pièce
                  </button>
                </div>
              </>
            )}

            {etat.etape === 'hauteur' && (
              <>
                <p className="releve-ra-statut">
                  {etat.hauteur !== null
                    ? `Hauteur retenue : ${etat.hauteur} cm (${etat.hauteurMesuree ? 'mesurée' : 'saisie'})`
                    : `Pièce de ${formaterValeur(aireAnglesM2(etat.angles), 'm²')} · hauteur à relever`}
                </p>
                {saisieHauteur && (
                  <div className="releve-ra-saisie">
                    <ChampNombre
                      libelle="Hauteur sous plafond"
                      valeur={hauteurSaisie}
                      onChange={setHauteurSaisie}
                      unite="cm"
                      min={50}
                      max={1000}
                      decimales={0}
                      autoFocus
                    />
                    <Bouton onClick={validerSaisieHauteur}>Valider</Bouton>
                  </div>
                )}
                <div className="releve-ra-rangee">
                  <button type="button" className="releve-ra-secondaire" onClick={() => envoyer({ type: 'modifier-angles' })}>
                    <Icone nom="retour" taille={22} />
                    Revenir aux angles
                  </button>
                  <button type="button" className="releve-ra-principal" onClick={mesurerHauteur}>
                    <IconeReleve nom="hauteur" taille={30} />
                    Mesurer la hauteur
                  </button>
                  <button type="button" className="releve-ra-secondaire" onClick={ouvrirSaisieHauteur}>
                    <Icone nom="crayon" taille={22} />
                    Saisir la hauteur
                  </button>
                </div>
                <Bouton pleineLargeur icone="valider" disabled={etat.hauteur === null} onClick={() => envoyer({ type: 'terminer-zone' })}>
                  Terminer la zone
                </Bouton>
              </>
            )}

            {etat.etape === 'zone-terminee' && derniereZone && (
              <>
                <p className="releve-ra-statut">
                  {`Zone ${etat.zones.length} : ${formaterValeur(aireAnglesM2(derniereZone.angles), 'm²')} · hauteur ${derniereZone.hauteur} cm`}
                </p>
                <div className="releve-ra-rangee deux">
                  <Bouton variante="contour" onClick={quitter}>
                    Quitter
                  </Bouton>
                  <Bouton icone="plus" onClick={() => envoyer({ type: 'nouvelle-zone' })}>
                    Relever une autre pièce
                  </Bouton>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
