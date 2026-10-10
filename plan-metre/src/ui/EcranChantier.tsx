// Écran principal d'un chantier : plan 2D / vue 3D, niveaux, plan actuel /
// plan rénové, annuler / rétablir, accès aux photos, au relevé et au métré.

import { useEffect, useState } from 'react';
import { copierPlanPourRenovation, nouveauNiveau } from '../model/fabrique';
import type { Variante } from '../model/types';
import { niveauCourant, planCourant, useEtat } from '../store/etat';
import { BarreHaut, Bouton, BoutonIcone, ChampNombre, ChampTexte, FeuilleBas, MenuActions, Segments } from './commun/composants';
import { confirmer, notifier } from './commun/dialogues';
import { Icone } from './commun/Icone';
import { EditeurPlan2D } from './plan/EditeurPlan2D';
import { Vue3D } from './plan3d/Vue3D';
import { naviguer } from './routeur';
import { useProjetOuvert } from './useProjetOuvert';

const NOMS_NIVEAUX = ['Sous-sol', 'RDC', 'R+1', 'R+2', 'R+3', 'Combles', 'Mezzanine'];
const AJOUTER_NIVEAU = '__ajouter__';

export function EcranChantier({ id }: { id: string }) {
  const projet = useProjetOuvert(id);
  const etat = useEtat();
  const [vue, setVue] = useState<'2d' | '3d'>('2d');
  const [formNiveau, setFormNiveau] = useState(false);

  // Raccourcis clavier (PC) : Ctrl+Z / Ctrl+Y / Ctrl+Maj+Z.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.tagName === 'SELECT')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useEtat.getState().annuler();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        useEtat.getState().retablir();
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, []);

  if (!projet) return <div className="chargement">Chargement du chantier…</div>;

  const niveau = niveauCourant(etat);
  const plan = planCourant(etat);
  const niveaux = [...projet.niveaux].sort((a, b) => a.ordre - b.ordre);

  const changerVariante = (v: Variante) => {
    const creation = v === 'renove' && niveau && !niveau.renove;
    etat.choisirVariante(v);
    if (creation) notifier('Plan rénové créé à partir du plan actuel');
  };

  const reinitialiserRenove = async () => {
    if (!niveau) return;
    const ok = await confirmer({
      titre: 'Repartir du plan actuel ?',
      message: `Le plan rénové du niveau « ${niveau.nom} » sera remplacé par une copie du plan actuel.`,
      libelleConfirmer: 'Remplacer',
      danger: true,
    });
    if (!ok) return;
    etat.modifierProjet((p) => {
      const n = p.niveaux.find((x) => x.id === niveau.id)!;
      n.renove = copierPlanPourRenovation(n.actuel);
    });
    etat.choisirVariante('renove');
  };

  const entreesMenu = [
    { libelle: 'Réglages du chantier', icone: 'parametres' as const, action: () => naviguer({ ecran: 'parametres', id }) },
    { libelle: 'Photos', icone: 'photo' as const, action: () => naviguer({ ecran: 'photos', id }) },
    { libelle: 'Métré', icone: 'metre' as const, action: () => naviguer({ ecran: 'metre', id }) },
    ...(niveau?.renove
      ? [{ libelle: 'Repartir du plan actuel', icone: 'rotation' as const, action: reinitialiserRenove, separateurAvant: true }]
      : []),
  ];

  return (
    <div className="ecran">
      <BarreHaut
        titre={projet.nom}
        sousTitre={etat.enregistrement === 'erreur' ? 'Enregistrement impossible — vérifiez l’espace disponible' : projet.adresse || undefined}
        onRetour={() => naviguer({ ecran: 'accueil' })}
        libelleRetour="Mes chantiers"
        actions={<MenuActions entrees={entreesMenu} />}
      />

      <div className="chantier-barre-niveau">
        <div className="saisie">
          <Icone nom="niveaux" taille={18} />
          <select
            aria-label="Niveau"
            value={niveau?.id ?? ''}
            onChange={(e) => {
              if (e.target.value === AJOUTER_NIVEAU) setFormNiveau(true);
              else etat.choisirNiveau(e.target.value);
            }}
          >
            {niveaux.map((n) => (
              <option key={n.id} value={n.id}>
                {n.nom}
              </option>
            ))}
            <option value={AJOUTER_NIVEAU}>＋ Ajouter un niveau…</option>
          </select>
        </div>
        <div className="separateur-vertical" />
        <BoutonIcone icone="annuler" libelle="Annuler" disabled={etat.passe.length === 0} onClick={etat.annuler} />
        <BoutonIcone icone="retablir" libelle="Rétablir" disabled={etat.futur.length === 0} onClick={etat.retablir} />
        <span style={{ flex: 1 }} />
        {etat.variante === 'renove' && <span className="badge renove">Plan rénové</span>}
      </div>

      <main className="chantier-zone">
        {vue === '2d' ? (
          <EditeurPlan2D />
        ) : (
          plan && niveau && <Vue3D plan={plan} catalogue={projet.catalogue} />
        )}
        <div className="chantier-outils-droite">
          <BoutonIcone
            flottant
            icone={vue === '2d' ? 'cube' : 'plan'}
            libelle={vue === '2d' ? 'Vue 3D' : 'Plan 2D'}
            onClick={() => setVue(vue === '2d' ? '3d' : '2d')}
          />
        </div>
        <div className="chantier-variante">
          <Segments
            libelle="Plan affiché"
            surPrimaire
            valeur={etat.variante}
            onChange={changerVariante}
            options={[
              { valeur: 'actuel', libelle: 'Plan actuel' },
              { valeur: 'renove', libelle: 'Plan rénové' },
            ]}
          />
        </div>
      </main>

      <nav className="nav-bas" aria-label="Navigation du chantier">
        <button type="button" className="nav-bas-lien" onClick={() => naviguer({ ecran: 'photos', id })}>
          <Icone nom="photo" />
          Photos{etat.photos.length > 0 ? ` (${etat.photos.length})` : ''}
        </button>
        <button
          type="button"
          className="nav-bas-central"
          aria-label="Ajouter une pièce"
          title="Ajouter une pièce"
          onClick={() => naviguer({ ecran: 'releve', id })}
        >
          <Icone nom="plus" taille={28} epaisseur={2.5} />
        </button>
        <button type="button" className="nav-bas-lien" onClick={() => naviguer({ ecran: 'metre', id })}>
          <Icone nom="metre" />
          Métré
        </button>
      </nav>

      <FormulaireNiveau ouvert={formNiveau} onFermer={() => setFormNiveau(false)} />
    </div>
  );
}

function FormulaireNiveau({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const projet = useEtat((e) => e.projet);
  const [nom, setNom] = useState('');
  const [hauteur, setHauteur] = useState(250);
  useEffect(() => {
    if (!ouvert || !projet) return;
    const existants = new Set(projet.niveaux.map((n) => n.nom));
    setNom(NOMS_NIVEAUX.find((n) => !existants.has(n) && n !== 'Sous-sol') ?? `Niveau ${projet.niveaux.length + 1}`);
  }, [ouvert, projet]);
  if (!projet) return null;
  const valider = () => {
    const n = nouveauNiveau(nom.trim() || `Niveau ${projet.niveaux.length + 1}`, 0, hauteur);
    useEtat.getState().modifierProjet((p) => {
      // « Sous-sol » se place sous les autres niveaux, le reste au-dessus.
      if (n.nom.toLowerCase().startsWith('sous-sol')) {
        p.niveaux.forEach((x) => (x.ordre += 1));
        n.ordre = 0;
      } else {
        n.ordre = Math.max(-1, ...p.niveaux.map((x) => x.ordre)) + 1;
      }
      p.niveaux.push(n);
    });
    useEtat.getState().choisirNiveau(n.id);
    onFermer();
  };
  return (
    <FeuilleBas
      ouverte={ouvert}
      titre="Nouveau niveau"
      onFermer={onFermer}
      pied={
        <>
          <Bouton variante="contour" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton onClick={valider}>Ajouter</Bouton>
        </>
      }
    >
      <ChampTexte libelle="Nom du niveau" valeur={nom} onChange={setNom} suggestions={NOMS_NIVEAUX} autoFocus />
      <ChampNombre libelle="Hauteur sous plafond par défaut" valeur={hauteur} onChange={setHauteur} unite="cm" min={50} max={1000} decimales={0} />
    </FeuilleBas>
  );
}
