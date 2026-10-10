// Finalisation de la capture : nom et hauteur de chaque zone, niveau et plan
// cibles, type de mur, redressement des angles, aperçu de l'assemblage, puis
// ajout des pièces au plan en une seule étape d'annulation.

import { useMemo, useState } from 'react';
import { NOMS_PIECES, TYPE_MUR_DEFAUT_ID } from '../../model/catalogue';
import { copierPlanPourRenovation, nouveauNiveau } from '../../model/fabrique';
import type { ID, Niveau, Plan, Projet, Variante } from '../../model/types';
import { useEtat } from '../../store/etat';
import {
  BarreHaut,
  Bouton,
  ChampNombre,
  ChampSelection,
  ChampTexte,
  Interrupteur,
  Segments,
} from '../commun/composants';
import { notifier } from '../commun/dialogues';
import { Vue3D } from '../plan3d/Vue3D';
import { ApercuAssemblage, surfaceM2, VignetteZone } from './Apercus';
import { boiteDesPieces, construirePieces, nomsParDefaut, placerZones, type ZoneRelevee } from './zones';

const NOMS_NIVEAUX = ['Sous-sol', 'RDC', 'R+1', 'R+2', 'R+3', 'Combles', 'Mezzanine'];
const NOUVEAU_NIVEAU = '__nouveau__';

function planCible(niveau: Niveau | null, variante: Variante): Plan {
  if (!niveau) return { pieces: [] };
  // Le plan rénové, s'il n'existe pas encore, partira d'une copie du plan actuel.
  return variante === 'renove' ? (niveau.renove ?? niveau.actuel) : niveau.actuel;
}

function suggestionNiveau(projet: Projet): string {
  const existants = new Set(projet.niveaux.map((n) => n.nom));
  return NOMS_NIVEAUX.find((n) => !existants.has(n) && n !== 'Sous-sol') ?? `Niveau ${projet.niveaux.length + 1}`;
}

export function Finalisation({
  projet,
  zones,
  niveauInitialId,
  varianteInitiale,
  onRetour,
  onTerminee,
}: {
  projet: Projet;
  zones: readonly ZoneRelevee[];
  niveauInitialId: ID | null;
  varianteInitiale: Variante;
  onRetour: () => void;
  onTerminee: () => void;
}) {
  const niveaux = useMemo(() => [...projet.niveaux].sort((a, b) => a.ordre - b.ordre), [projet.niveaux]);
  const [niveauId, setNiveauId] = useState<string>(() =>
    niveaux.some((n) => n.id === niveauInitialId) ? niveauInitialId! : (niveaux[0]?.id ?? NOUVEAU_NIVEAU),
  );
  const [nomNiveau, setNomNiveau] = useState(() => suggestionNiveau(projet));
  const [variante, setVariante] = useState<Variante>(varianteInitiale);
  const [typeMurId, setTypeMurId] = useState<string>(() =>
    projet.catalogue.typesMurs.some((t) => t.id === TYPE_MUR_DEFAUT_ID)
      ? TYPE_MUR_DEFAUT_ID
      : (projet.catalogue.typesMurs[0]?.id ?? TYPE_MUR_DEFAUT_ID),
  );
  // Relevé approximatif en réalité augmentée : redressé par défaut.
  const [redresser, setRedresser] = useState(() => zones.some((z) => z.methode === 'ra'));
  const [noms, setNoms] = useState<Record<string, string>>(() => {
    const niveau = niveaux.find((n) => n.id === niveauInitialId) ?? niveaux[0] ?? null;
    const pris = [...planCible(niveau, varianteInitiale).pieces.map((p) => p.nom), ...zones.map((z) => z.nom)];
    const defauts = nomsParDefaut(zones.filter((z) => !z.nom.trim()).length, pris);
    let k = 0;
    return Object.fromEntries(zones.map((z) => [z.id, z.nom.trim() || defauts[k++]]));
  });
  const [hauteurs, setHauteurs] = useState<Record<string, number>>(() =>
    Object.fromEntries(zones.map((z) => [z.id, Math.round(z.hauteur)])),
  );
  const [vue, setVue] = useState<'2d' | '3d'>('2d');

  const niveau = niveaux.find((n) => n.id === niveauId) ?? null;
  const cible = planCible(niveau, variante);
  const placees = useMemo(
    () => placerZones(zones, { redresser, existant: boiteDesPieces(cible.pieces, projet.catalogue) }),
    [zones, redresser, cible, projet.catalogue],
  );
  const nouvelles = useMemo(
    () => construirePieces(placees, { noms, hauteurs, typeMurDefautId: typeMurId }),
    [placees, noms, hauteurs, typeMurId],
  );
  const planApercu = useMemo<Plan>(() => ({ pieces: [...cible.pieces, ...nouvelles] }), [cible, nouvelles]);

  const sauvegarder = () => {
    let idNiveau: ID | null = null;
    useEtat.getState().modifierProjet((p) => {
      let n = p.niveaux.find((x) => x.id === niveauId);
      if (!n) {
        const nom = nomNiveau.trim() || `Niveau ${p.niveaux.length + 1}`;
        n = nouveauNiveau(nom, 0, (zones[0] && hauteurs[zones[0].id]) || 250);
        // « Sous-sol » se place sous les autres niveaux, le reste au-dessus.
        if (nom.toLowerCase().startsWith('sous-sol')) {
          p.niveaux.forEach((x) => (x.ordre += 1));
          n.ordre = 0;
        } else {
          n.ordre = Math.max(-1, ...p.niveaux.map((x) => x.ordre)) + 1;
        }
        p.niveaux.push(n);
      }
      if (variante === 'renove' && !n.renove) n.renove = copierPlanPourRenovation(n.actuel);
      const plan = variante === 'renove' ? n.renove! : n.actuel;
      const poses = placerZones(zones, { redresser, existant: boiteDesPieces(plan.pieces, p.catalogue) });
      plan.pieces.push(...construirePieces(poses, { noms, hauteurs, typeMurDefautId: typeMurId }));
      idNiveau = n.id;
    });
    if (!idNiveau) return;
    const etat = useEtat.getState();
    etat.choisirNiveau(idNiveau);
    etat.choisirVariante(variante);
    notifier(zones.length > 1 ? `${zones.length} pièces ajoutées` : '1 pièce ajoutée');
    onTerminee();
  };

  const optionsNiveaux = [
    ...niveaux.map((n) => ({ valeur: n.id, libelle: n.nom })),
    { valeur: NOUVEAU_NIVEAU, libelle: '＋ Nouveau niveau…' },
  ];

  return (
    <div className="ecran">
      <BarreHaut titre="Finaliser la capture" sousTitre={`${zones.length} zone${zones.length > 1 ? 's' : ''}`} onRetour={onRetour} />
      <div className="ecran-contenu etroit releve-finalisation">
        <div className="releve-entete-apercu">
          <h2 className="titre-section">Aperçu</h2>
          <Segments
            libelle="Aperçu"
            valeur={vue}
            onChange={setVue}
            options={[
              { valeur: '2d', libelle: 'Plan 2D' },
              { valeur: '3d', libelle: 'Vue 3D' },
            ]}
          />
        </div>
        <div className="releve-cadre-apercu releve-cadre-assemblage">
          {vue === '2d' ? (
            <ApercuAssemblage
              existantes={cible.pieces.map((p) => p.sommets)}
              nouvelles={nouvelles.map((p, i) => ({ id: placees[i].zone.id, nom: p.nom, points: p.sommets }))}
            />
          ) : (
            <div className="releve-apercu-3d">
              <Vue3D plan={planApercu} catalogue={projet.catalogue} />
            </div>
          )}
        </div>

        <h2 className="titre-section">Pièces</h2>
        {zones.map((z, i) => (
          <div key={z.id} className="carte releve-carte-zone">
            <div className="releve-carte-zone-entete">
              <VignetteZone points={placees[i]?.points ?? z.points} taille={48} />
              <span className="releve-zone-surface">{surfaceM2(placees[i]?.points ?? z.points)}</span>
            </div>
            <div className="releve-carte-zone-champs">
              <ChampTexte
                libelle={`Nom de la zone ${i + 1}`}
                valeur={noms[z.id] ?? ''}
                onChange={(v) => setNoms({ ...noms, [z.id]: v })}
                suggestions={NOMS_PIECES}
              />
              <ChampNombre
                libelle="Hauteur sous plafond"
                valeur={hauteurs[z.id] ?? z.hauteur}
                onChange={(v) => setHauteurs({ ...hauteurs, [z.id]: v })}
                unite="cm"
                min={50}
                max={1000}
                decimales={0}
              />
            </div>
          </div>
        ))}

        <h2 className="titre-section">Destination</h2>
        <div className="carte">
          <ChampSelection libelle="Niveau" valeur={niveauId} options={optionsNiveaux} onChange={setNiveauId} />
          {niveauId === NOUVEAU_NIVEAU && (
            <ChampTexte libelle="Nom du nouveau niveau" valeur={nomNiveau} onChange={setNomNiveau} suggestions={NOMS_NIVEAUX} />
          )}
          <div className="champ">
            <span className="champ-libelle">Plan</span>
            <Segments
              libelle="Plan cible"
              valeur={variante}
              onChange={setVariante}
              options={[
                { valeur: 'actuel', libelle: 'Plan actuel' },
                { valeur: 'renove', libelle: 'Plan rénové' },
              ]}
            />
            {variante === 'renove' && !niveau?.renove && (
              <span className="champ-aide">Le plan rénové sera créé à partir du plan actuel.</span>
            )}
          </div>
          <ChampSelection
            libelle="Type de mur par défaut"
            valeur={typeMurId}
            options={projet.catalogue.typesMurs.map((t) => ({ valeur: t.id, libelle: t.nom }))}
            onChange={setTypeMurId}
          />
          <Interrupteur
            libelle="Redresser les angles"
            aide="Rend parfaitement droits les angles proches de 90°."
            coche={redresser}
            onChange={setRedresser}
          />
        </div>
      </div>
      <div className="releve-pied">
        <Bouton pleineLargeur icone="valider" onClick={sauvegarder}>
          Sauvegarder et continuer
        </Bouton>
      </div>
    </div>
  );
}
