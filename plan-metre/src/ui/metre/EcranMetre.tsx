// Écran Métré : quantités du chantier à la manière de Visuary (Global / Par
// étage / Par pièce), pour le plan actuel, le plan rénové ou les deux en
// regard (écarts), avec copie vers Excel ou un devis et impression (PDF).

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formaterEcart } from '../../metre/calcul';
import { useEtat } from '../../store/etat';
import { BarreHaut, Bouton, BoutonIcone, EtatVide, Segments } from '../commun/composants';
import { notifier } from '../commun/dialogues';
import { Icone } from '../commun/Icone';
import { naviguer } from '../routeur';
import { useProjetOuvert } from '../useProjetOuvert';
import { GuideMetre } from './GuideMetre';
import {
  blocModifie,
  calculerMetres,
  construireVueMetre,
  ecartNonNul,
  ecartValeurs,
  formaterCase,
  formaterEcartPieces,
  formaterPieces,
  LIBELLES_MODES,
  LIBELLES_ONGLETS,
  texteTabule,
  type BlocMetre,
  type GroupeMetre,
  type LigneTableau,
  type ModeMetre,
  type OngletMetre,
  type SectionTableau,
  type VueMetre,
} from './presentation';
import './metre.css';

const ONGLETS: OngletMetre[] = ['global', 'etage', 'piece'];

const OPTIONS_MODES: { valeur: ModeMetre; libelle: string }[] = [
  { valeur: 'actuel', libelle: 'Plan actuel' },
  { valeur: 'renove', libelle: 'Plan rénové' },
  { valeur: 'comparer', libelle: 'Comparer' },
];

/** Derniers choix, gardés le temps de la session (retour depuis le plan). */
let dernierChoix: { projetId: string; mode: ModeMetre; onglet: OngletMetre } | null = null;

/** Copie dans le presse-papiers ; repli pour les pages servies sans HTTPS (pas d'API Clipboard). */
async function copierTexte(texte: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(texte);
    return;
  }
  const zone = document.createElement('textarea');
  zone.value = texte;
  zone.setAttribute('readonly', '');
  zone.style.position = 'fixed';
  zone.style.top = '0';
  zone.style.opacity = '0';
  document.body.appendChild(zone);
  try {
    zone.select();
    if (!document.execCommand('copy')) throw new Error('Copie refusée');
  } finally {
    zone.remove();
  }
}

function dateDuJour(): string {
  return new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function EcranMetre({ id }: { id: string }) {
  const projet = useProjetOuvert(id);
  // Par défaut, le plan affiché sur l'écran du plan (si c'est bien ce chantier qui est ouvert).
  const [mode, setMode] = useState<ModeMetre>(() => {
    if (dernierChoix?.projetId === id) return dernierChoix.mode;
    const etat = useEtat.getState();
    return etat.projet?.id === id ? etat.variante : 'actuel';
  });
  const [onglet, setOnglet] = useState<OngletMetre>(() => (dernierChoix?.projetId === id ? dernierChoix.onglet : 'global'));
  const [guide, setGuide] = useState(false);
  /** Cartes de pièces repliées (clés de bloc). */
  const [replies, setReplies] = useState<ReadonlySet<string>>(() => new Set());
  const idBase = useId();

  useEffect(() => {
    dernierChoix = { projetId: id, mode, onglet };
  }, [id, mode, onglet]);

  const metres = useMemo(() => (projet ? calculerMetres(projet) : null), [projet]);
  const vue = useMemo(
    () => (projet && metres ? construireVueMetre(projet, metres, mode, onglet) : null),
    [projet, metres, mode, onglet],
  );
  const fermerGuide = useCallback(() => setGuide(false), []);

  if (!projet || !vue) return <div className="chargement">Chargement du chantier…</div>;

  const date = dateDuJour();
  const allerAuPlan = () => naviguer({ ecran: 'chantier', id });

  const copier = async () => {
    const texte = texteTabule(vue, { nom: projet.nom, client: projet.client, adresse: projet.adresse, date });
    try {
      await copierTexte(texte);
      notifier('Métré copié : collez-le dans Excel ou dans un devis');
    } catch {
      notifier('Copie impossible : le navigateur a refusé l’accès au presse-papiers', { erreur: true });
    }
  };

  const ouvrirPiece = (b: BlocMetre) => {
    if (!b.niveauId || !b.pieceId) return;
    const etat = useEtat.getState();
    etat.choisirNiveau(b.niveauId);
    // La variante cible n'est « renove » que si le niveau a déjà un plan rénové : rien n'est créé.
    etat.choisirVariante(b.varianteCible ?? 'actuel');
    etat.selectionner({ type: 'piece', pieceId: b.pieceId });
    naviguer({ ecran: 'chantier', id });
  };

  const basculer = (cle: string) =>
    setReplies((r) => {
      const n = new Set(r);
      if (n.has(cle)) n.delete(cle);
      else n.add(cle);
      return n;
    });

  const idPanneau = `${idBase}-panneau`;
  const idOnglet = (o: OngletMetre) => `${idBase}-onglet-${o}`;

  return (
    <div className="ecran metre-ecran">
      <BarreHaut
        titre="Métré"
        sousTitre={projet.nom}
        onRetour={allerAuPlan}
        libelleRetour="Retour au plan"
        actions={
          <>
            <BoutonIcone icone="aide" libelle="Voir le guide" onClick={() => setGuide(true)} />
            <BoutonIcone icone="dupliquer" libelle="Copier" disabled={vue.vide} onClick={() => void copier()} />
            <BoutonIcone icone="imprimer" libelle="Imprimer / PDF" disabled={vue.vide} onClick={() => window.print()} />
          </>
        }
      />

      <div className="metre-controles ne-pas-imprimer">
        <Segments libelle="Plan présenté" valeur={mode} onChange={setMode} options={OPTIONS_MODES} />
      </div>
      <Onglets valeur={onglet} onChange={setOnglet} idPanneau={idPanneau} idOnglet={idOnglet} />

      <main className="ecran-contenu metre-contenu">
        <div className="metre-page metre-panneau" role="tabpanel" id={idPanneau} aria-labelledby={idOnglet(onglet)} tabIndex={0}>
          <header className="metre-impression">
            <h1>Métré — {projet.nom}</h1>
            {projet.client && <p>Client : {projet.client}</p>}
            {projet.adresse && <p>{projet.adresse}</p>}
            <p>
              {LIBELLES_MODES[mode]} · {LIBELLES_ONGLETS[onglet]} · édité le {date}
            </p>
          </header>

          {mode !== 'actuel' && vue.aucunPlanRenove && (
            <div className="metre-avis" role="note">
              <Icone nom="info" />
              <div>
                <p>
                  <strong>Aucun niveau n’a de plan rénové.</strong> Créez le plan rénové depuis l’écran du plan. En attendant,
                  chaque niveau est réputé inchangé : {mode === 'comparer' ? 'les écarts sont nuls' : 'le métré est celui du plan actuel'}.
                </p>
                {!vue.vide && (
                  <Bouton variante="fantome" petit icone="plan" className="ne-pas-imprimer metre-avis-bouton" onClick={allerAuPlan}>
                    Aller au plan
                  </Bouton>
                )}
              </div>
            </div>
          )}
          {mode !== 'actuel' && !vue.aucunPlanRenove && onglet === 'global' && vue.niveauxInchanges.length > 0 && (
            <p className="metre-note">
              <Icone nom="info" taille={16} />
              Sans plan rénové, réputé inchangé : {vue.niveauxInchanges.join(', ')}
            </p>
          )}

          {vue.vide ? (
            <EtatVide icone="plan" titre="Aucune pièce">
              <p className="metre-vide-texte">Relevez ou dessinez une pièce pour obtenir le métré.</p>
              <Bouton icone="plan" onClick={allerAuPlan}>
                Aller au plan
              </Bouton>
            </EtatVide>
          ) : onglet === 'global' ? (
            <VueGlobale vue={vue} />
          ) : onglet === 'etage' ? (
            <VueEtages vue={vue} />
          ) : (
            <VuePieces vue={vue} replies={replies} setReplies={setReplies} onBasculer={basculer} onOuvrir={ouvrirPiece} />
          )}
        </div>
      </main>

      <GuideMetre
        ouvert={guide}
        onFermer={fermerGuide}
        parametres={projet.parametres}
        onReglages={() => {
          setGuide(false);
          naviguer({ ecran: 'parametres', id });
        }}
      />
    </div>
  );
}

function Onglets({
  valeur,
  onChange,
  idPanneau,
  idOnglet,
}: {
  valeur: OngletMetre;
  onChange: (o: OngletMetre) => void;
  idPanneau: string;
  idOnglet: (o: OngletMetre) => string;
}) {
  const boutons = useRef<(HTMLButtonElement | null)[]>([]);
  // Flèches, Début et Fin déplacent l'onglet actif (motif « tablist » ARIA).
  const surTouche = (e: KeyboardEvent, i: number) => {
    const n = ONGLETS.length;
    const cible =
      e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (cible < 0) return;
    e.preventDefault();
    onChange(ONGLETS[cible]);
    boutons.current[cible]?.focus();
  };
  return (
    <div className="onglets metre-onglets ne-pas-imprimer" role="tablist" aria-label="Présentation du métré">
      {ONGLETS.map((o, i) => (
        <button
          key={o}
          ref={(el) => {
            boutons.current[i] = el;
          }}
          type="button"
          role="tab"
          id={idOnglet(o)}
          aria-selected={o === valeur}
          aria-controls={idPanneau}
          tabIndex={o === valeur ? 0 : -1}
          onClick={() => onChange(o)}
          onKeyDown={(e) => surTouche(e, i)}
        >
          {LIBELLES_ONGLETS[o]}
        </button>
      ))}
    </div>
  );
}

// ─── Global ──────────────────────────────────────────────────────────────

function VueGlobale({ vue }: { vue: VueMetre }) {
  const bloc = vue.groupes[0]?.blocs[0];
  if (!bloc) return null;
  return (
    <>
      <Synthese bloc={bloc} vue={vue} />
      <Sections sections={bloc.sections} vue={vue} cle={bloc.cle} />
    </>
  );
}

/** Synthèse de tout le chantier : surface totale en tête, nombre de pièces. */
function Synthese({ bloc, vue }: { bloc: BlocMetre; vue: VueMetre }) {
  const { pieces, surface } = bloc.resume;
  if (vue.mode !== 'comparer') {
    return (
      <div className="metre-synthese" data-cle="synthese">
        <div className="metre-chiffre">
          <span className="metre-chiffre-libelle">Surface totale</span>
          <span className="metre-chiffre-valeur" data-cle="synthese:surface">
            {formaterCase(surface[0], 'm²')}
          </span>
        </div>
        <div className="metre-chiffre secondaire">
          <span className="metre-chiffre-libelle">Pièces</span>
          <span className="metre-chiffre-valeur" data-cle="synthese:pieces">
            {pieces[0] ?? 0}
          </span>
        </div>
      </div>
    );
  }
  const ecartSurface = ecartValeurs(surface);
  const ecartPieces = ecartValeurs(pieces);
  return (
    <div className="metre-tableau-cadre metre-synthese-comparee" data-cle="synthese">
      <table className="metre-tableau comparaison">
        <EnteteComparaison vue={vue} />
        <tbody>
          <tr className="metre-ligne metre-ligne-forte" data-cle="synthese:surface">
            <th scope="row" className="metre-libelle">
              Surface totale
            </th>
            <td className="metre-valeur" data-colonne="actuel">
              {formaterCase(surface[0], 'm²')}
            </td>
            <td className="metre-valeur" data-colonne="renove">
              {formaterCase(surface[1], 'm²')}
            </td>
            <CelluleEcart texte={formaterEcart(ecartSurface, 'm²')} nonNul={ecartNonNul(ecartSurface, 'm²')} />
          </tr>
          <tr className="metre-ligne" data-cle="synthese:pieces">
            <th scope="row" className="metre-libelle">
              Pièces
            </th>
            <td className="metre-valeur" data-colonne="actuel">
              {pieces[0] ?? 0}
            </td>
            <td className="metre-valeur" data-colonne="renove">
              {pieces[1] ?? 0}
            </td>
            <CelluleEcart texte={formaterEcartPieces(ecartPieces)} nonNul={Math.round(ecartPieces) !== 0} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Par étage ───────────────────────────────────────────────────────────

function resumeBloc(b: BlocMetre, vue: VueMetre): string | null {
  const { pieces, surface } = b.resume;
  if (vue.mode === 'comparer') {
    return `Actuel : ${formaterPieces(pieces[0] ?? 0)} · Rénové : ${formaterPieces(pieces[1] ?? 0)}`;
  }
  if (!pieces[0]) return null;
  return `${formaterPieces(pieces[0])} · ${formaterCase(surface[0], 'm²')}`;
}

function VueEtages({ vue }: { vue: VueMetre }) {
  return (
    <>
      {vue.groupes[0]?.blocs.map((b) => {
        const resume = resumeBloc(b, vue);
        const idTitre = `metre-titre-${b.cle}`;
        return (
          <section key={b.cle} className="metre-bloc" aria-labelledby={idTitre} data-bloc={b.cle}>
            <header className="metre-bloc-entete">
              <h2 className="metre-bloc-titre" id={idTitre}>
                {b.titre}
              </h2>
              {resume && <span className="metre-bloc-resume">{resume}</span>}
            </header>
            {b.note && <Note texte={b.note} />}
            <Sections sections={b.sections} vue={vue} cle={b.cle} />
          </section>
        );
      })}
    </>
  );
}

// ─── Par pièce ───────────────────────────────────────────────────────────

function VuePieces({
  vue,
  replies,
  setReplies,
  onBasculer,
  onOuvrir,
}: {
  vue: VueMetre;
  replies: ReadonlySet<string>;
  setReplies: (r: ReadonlySet<string>) => void;
  onBasculer: (cle: string) => void;
  onOuvrir: (b: BlocMetre) => void;
}) {
  const cles = vue.groupes.flatMap((g) => g.blocs.map((b) => b.cle));
  const toutReplie = cles.length > 0 && cles.every((c) => replies.has(c));
  return (
    <>
      {cles.length > 1 && (
        <div className="metre-pieces-actions ne-pas-imprimer">
          <Bouton variante="fantome" petit onClick={() => setReplies(toutReplie ? new Set() : new Set(cles))}>
            {toutReplie ? 'Tout déplier' : 'Tout replier'}
          </Bouton>
        </div>
      )}
      {vue.groupes.map((g) => (
        <GroupePieces key={g.cle} groupe={g} vue={vue} replies={replies} onBasculer={onBasculer} onOuvrir={onOuvrir} />
      ))}
    </>
  );
}

function GroupePieces({
  groupe,
  vue,
  replies,
  onBasculer,
  onOuvrir,
}: {
  groupe: GroupeMetre;
  vue: VueMetre;
  replies: ReadonlySet<string>;
  onBasculer: (cle: string) => void;
  onOuvrir: (b: BlocMetre) => void;
}) {
  const idTitre = `metre-titre-${groupe.cle}`;
  return (
    <section className="metre-bloc" aria-labelledby={idTitre} data-bloc={groupe.cle}>
      <header className="metre-bloc-entete">
        <h2 className="metre-bloc-titre" id={idTitre}>
          {groupe.titre}
        </h2>
        {groupe.blocs.length > 0 && <span className="metre-bloc-resume">{formaterPieces(groupe.blocs.length)}</span>}
      </header>
      {groupe.note && <Note texte={groupe.note} />}
      {groupe.blocs.map((b) => (
        <CartePiece
          key={b.cle}
          bloc={b}
          vue={vue}
          replie={replies.has(b.cle)}
          onBasculer={() => onBasculer(b.cle)}
          onOuvrir={() => onOuvrir(b)}
        />
      ))}
    </section>
  );
}

function CartePiece({
  bloc,
  vue,
  replie,
  onBasculer,
  onOuvrir,
}: {
  bloc: BlocMetre;
  vue: VueMetre;
  replie: boolean;
  onBasculer: () => void;
  onOuvrir: () => void;
}) {
  const idCorps = useId();
  const { surface } = bloc.resume;
  const ecart = ecartValeurs(surface);
  const comparer = vue.mode === 'comparer';
  const surfaceChange = comparer && ecartNonNul(ecart, 'm²');
  // En comparaison : écart de surface, sinon « Modifiée » (murs, ouvertures…) ou « Inchangée ».
  const resume = !comparer
    ? formaterCase(surface[0], 'm²')
    : surfaceChange
      ? formaterEcart(ecart, 'm²')
      : blocModifie(bloc)
        ? 'Modifiée'
        : 'Inchangée';
  return (
    <article className="metre-carte" data-piece={bloc.pieceId ?? undefined}>
      <div className="metre-carte-entete">
        <button
          type="button"
          className="metre-carte-nom"
          aria-label={`${bloc.titre}, voir sur le plan`}
          title="Voir la pièce sur le plan"
          onClick={onOuvrir}
        >
          <span className="metre-carte-nom-texte">{bloc.titre}</span>
          <Icone nom="plan" taille={18} />
        </button>
        {bloc.statut === 'nouvelle' && <span className="badge renove">Nouvelle</span>}
        {bloc.statut === 'supprimee' && <span className="badge metre-badge-supprimee">Supprimée</span>}
        <span className={`metre-carte-resume${comparer && resume !== 'Inchangée' ? ' non-nul' : ''}`}>{resume}</span>
        <button
          type="button"
          className="bouton-icone metre-carte-bascule ne-pas-imprimer"
          aria-expanded={!replie}
          aria-controls={idCorps}
          aria-label={`${replie ? 'Déplier' : 'Replier'} le détail de ${bloc.titre}`}
          title={replie ? 'Déplier' : 'Replier'}
          onClick={onBasculer}
        >
          <Icone nom="bas" />
        </button>
      </div>
      <div className="metre-carte-corps" id={idCorps} hidden={replie}>
        <Sections sections={bloc.sections} vue={vue} cle={bloc.cle} />
      </div>
    </article>
  );
}

// ─── Sections et lignes ──────────────────────────────────────────────────

function Note({ texte }: { texte: string }) {
  return (
    <p className="metre-note">
      <Icone nom="info" taille={16} />
      {texte}
    </p>
  );
}

function Sections({ sections, vue, cle }: { sections: SectionTableau[]; vue: VueMetre; cle: string }) {
  return (
    <>
      {sections.map((s) => (
        <TableauSection key={s.id} section={s} vue={vue} idTitre={`metre-section-${cle}-${s.id}`} />
      ))}
    </>
  );
}

function EnteteComparaison({ vue }: { vue: VueMetre }) {
  return (
    <thead>
      <tr>
        <th scope="col">
          <span className="visuellement-cache">Désignation</span>
        </th>
        {vue.colonnes.map((c) => (
          <th scope="col" key={c}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function TableauSection({ section, vue, idTitre }: { section: SectionTableau; vue: VueMetre; idTitre: string }) {
  const comparer = vue.mode === 'comparer';
  return (
    <section className="metre-section" data-section={section.id}>
      <h3 className="metre-section-titre" id={idTitre}>
        <span>{section.titre}</span>
        {section.sousTitre && <span className="metre-section-sous-titre">{section.sousTitre}</span>}
      </h3>
      <div className="metre-tableau-cadre">
        <table className={`metre-tableau${comparer ? ' comparaison' : ''}`} aria-labelledby={idTitre}>
          {comparer && <EnteteComparaison vue={vue} />}
          <tbody>
            {section.lignes.map((l) => (
              <Ligne key={l.cle} ligne={l} comparer={comparer} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Ligne({ ligne, comparer }: { ligne: LigneTableau; comparer: boolean }) {
  const colonnes = comparer ? ['actuel', 'renove'] : ['valeur'];
  const ecart = ligne.ecart ?? ecartValeurs(ligne.valeurs);
  return (
    <tr className="metre-ligne" data-cle={ligne.cle}>
      <th scope="row" className="metre-libelle">
        {ligne.libelle}
        {ligne.precision && <span className="metre-precision">{ligne.precision}</span>}
      </th>
      {ligne.valeurs.map((v, i) => (
        <td key={colonnes[i]} className={`metre-valeur${v === null ? ' absente' : ''}`} data-colonne={colonnes[i]}>
          {formaterCase(v, ligne.unite)}
        </td>
      ))}
      {comparer && <CelluleEcart texte={formaterEcart(ecart, ligne.unite)} nonNul={ecartNonNul(ecart, ligne.unite)} />}
    </tr>
  );
}

function CelluleEcart({ texte, nonNul }: { texte: string; nonNul: boolean }) {
  return (
    <td className={`metre-valeur metre-ecart${nonNul ? ' non-nul' : ''}`} data-colonne="ecart">
      <span>{texte}</span>
    </td>
  );
}
