// Composants d'interface partagés par tous les écrans.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icone, type NomIcone } from './Icone';

type VarianteBouton = 'primaire' | 'secondaire' | 'contour' | 'fantome' | 'danger';

export function Bouton({
  variante = 'primaire',
  icone,
  pleineLargeur,
  petit,
  className,
  children,
  type = 'button',
  ...reste
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBouton;
  icone?: NomIcone;
  pleineLargeur?: boolean;
  petit?: boolean;
}) {
  const classes = ['bouton', variante, pleineLargeur && 'pleine-largeur', petit && 'petit', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...reste}>
      {icone && <Icone nom={icone} taille={petit ? 18 : 20} />}
      {children}
    </button>
  );
}

export function BoutonIcone({
  icone,
  libelle,
  actif,
  flottant,
  className,
  type = 'button',
  ...reste
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icone: NomIcone;
  /** Texte lu par les lecteurs d'écran et affiché en info-bulle. */
  libelle: string;
  actif?: boolean;
  flottant?: boolean;
}) {
  const classes = ['bouton-icone', actif && 'actif', flottant && 'flottant', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} aria-label={libelle} title={libelle} aria-pressed={actif} {...reste}>
      <Icone nom={icone} />
    </button>
  );
}

export function BarreHaut({
  titre,
  sousTitre,
  onRetour,
  libelleRetour = 'Retour',
  iconeRetour = 'retour',
  actions,
}: {
  titre: ReactNode;
  sousTitre?: ReactNode;
  onRetour?: () => void;
  libelleRetour?: string;
  iconeRetour?: NomIcone;
  actions?: ReactNode;
}) {
  return (
    <header className="barre-haut">
      {onRetour && <BoutonIcone icone={iconeRetour} libelle={libelleRetour} onClick={onRetour} />}
      <h1 className="barre-haut-titre">
        {titre}
        {sousTitre && <span className="barre-haut-sous-titre">{sousTitre}</span>}
      </h1>
      {actions}
    </header>
  );
}

/** Panneau qui monte du bas de l'écran (formulaires, propriétés). */
export function FeuilleBas({
  ouverte,
  titre,
  onFermer,
  pied,
  children,
  sansVoile,
}: {
  ouverte: boolean;
  titre: ReactNode;
  onFermer: () => void;
  pied?: ReactNode;
  children: ReactNode;
  /** Laisse le plan manipulable derrière le panneau. */
  sansVoile?: boolean;
}) {
  const idTitre = useId();
  useEffect(() => {
    if (!ouverte) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFermer();
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [ouverte, onFermer]);
  if (!ouverte) return null;
  return createPortal(
    <>
      {!sansVoile && <div className="voile" onClick={onFermer} />}
      <section className="feuille" role="dialog" aria-modal={!sansVoile} aria-labelledby={idTitre}>
        <div className="feuille-poignee" />
        <div className="feuille-entete">
          <h2 id={idTitre}>{titre}</h2>
          <BoutonIcone icone="fermer" libelle="Fermer" onClick={onFermer} />
        </div>
        <div className="feuille-corps">{children}</div>
        {pied && <div className="feuille-pied">{pied}</div>}
      </section>
    </>,
    document.body,
  );
}

export function Champ({
  libelle,
  aide,
  children,
  htmlFor,
}: {
  libelle: ReactNode;
  aide?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="champ">
      <label className="champ-libelle" htmlFor={htmlFor}>
        {libelle}
      </label>
      {children}
      {aide && <span className="champ-aide">{aide}</span>}
    </div>
  );
}

/** Lit un nombre saisi à la française (« 2,5 », « 2 500 »). NaN si invalide. */
export function lireNombre(texte: string): number {
  const propre = texte.replace(/[\s  ]/g, '').replace(',', '.');
  if (propre === '' || propre === '-' || propre === '.') return NaN;
  return Number(propre);
}

export function ecrireNombre(v: number, decimales = 2): string {
  if (!Number.isFinite(v)) return '';
  const r = Math.round(v * 10 ** decimales) / 10 ** decimales;
  return String(r).replace('.', ',');
}

/**
 * Champ numérique : accepte la virgule, valide à la sortie du champ ou sur
 * Entrée, et revient à la dernière valeur correcte si la saisie est invalide.
 */
export function ChampNombre({
  libelle,
  valeur,
  onChange,
  unite,
  min,
  max,
  decimales = 1,
  aide,
  autoFocus,
}: {
  libelle: ReactNode;
  valeur: number;
  onChange: (v: number) => void;
  unite?: string;
  min?: number;
  max?: number;
  decimales?: number;
  aide?: ReactNode;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [texte, setTexte] = useState(() => ecrireNombre(valeur, decimales));
  const [edition, setEdition] = useState(false);
  useEffect(() => {
    if (!edition) setTexte(ecrireNombre(valeur, decimales));
  }, [valeur, decimales, edition]);
  const n = lireNombre(texte);
  const invalide = texte !== '' && (Number.isNaN(n) || (min !== undefined && n < min) || (max !== undefined && n > max));
  const valider = () => {
    setEdition(false);
    if (!Number.isNaN(n) && !invalide && n !== valeur) onChange(n);
    else setTexte(ecrireNombre(valeur, decimales));
  };
  return (
    <Champ libelle={libelle} aide={aide} htmlFor={id}>
      <div className={`saisie${invalide ? ' invalide' : ''}`}>
        <input
          id={id}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          value={texte}
          autoFocus={autoFocus}
          onFocus={(e) => {
            setEdition(true);
            e.currentTarget.select();
          }}
          onChange={(e) => setTexte(e.target.value)}
          onBlur={valider}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {unite && <span className="saisie-unite">{unite}</span>}
      </div>
    </Champ>
  );
}

export function ChampTexte({
  libelle,
  valeur,
  onChange,
  placeholder,
  aide,
  multiligne,
  autoFocus,
  suggestions,
}: {
  libelle: ReactNode;
  valeur: string;
  onChange: (v: string) => void;
  placeholder?: string;
  aide?: ReactNode;
  multiligne?: boolean;
  autoFocus?: boolean;
  /** Propositions (liste déroulante native). */
  suggestions?: readonly string[];
}) {
  const id = useId();
  const idListe = useId();
  return (
    <Champ libelle={libelle} aide={aide} htmlFor={id}>
      <div className="saisie">
        {multiligne ? (
          <textarea id={id} value={valeur} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input
            id={id}
            value={valeur}
            placeholder={placeholder}
            autoFocus={autoFocus}
            list={suggestions ? idListe : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {suggestions && (
          <datalist id={idListe}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </div>
    </Champ>
  );
}

export interface OptionSelection<T extends string> {
  valeur: T;
  libelle: string;
}

export function ChampSelection<T extends string>({
  libelle,
  valeur,
  options,
  onChange,
  aide,
}: {
  libelle: ReactNode;
  valeur: T;
  options: readonly OptionSelection<T>[];
  onChange: (v: T) => void;
  aide?: ReactNode;
}) {
  const id = useId();
  return (
    <Champ libelle={libelle} aide={aide} htmlFor={id}>
      <div className="saisie">
        <select id={id} value={valeur} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.valeur} value={o.valeur}>
              {o.libelle}
            </option>
          ))}
        </select>
      </div>
    </Champ>
  );
}

export function Interrupteur({
  libelle,
  coche,
  onChange,
  aide,
}: {
  libelle: ReactNode;
  coche: boolean;
  onChange: (v: boolean) => void;
  aide?: ReactNode;
}) {
  return (
    <label className="interrupteur">
      <span>
        {libelle}
        {aide && (
          <>
            <br />
            <span className="champ-aide">{aide}</span>
          </>
        )}
      </span>
      <input type="checkbox" role="switch" checked={coche} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Segments<T extends string>({
  options,
  valeur,
  onChange,
  surPrimaire,
  libelle,
}: {
  options: readonly OptionSelection<T>[];
  valeur: T;
  onChange: (v: T) => void;
  surPrimaire?: boolean;
  /** Nom du groupe pour les lecteurs d'écran. */
  libelle: string;
}) {
  return (
    <div className={`segments${surPrimaire ? ' sur-primaire' : ''}`} role="group" aria-label={libelle}>
      {options.map((o) => (
        <button key={o.valeur} type="button" aria-pressed={o.valeur === valeur} onClick={() => onChange(o.valeur)}>
          {o.libelle}
        </button>
      ))}
    </div>
  );
}

export interface EntreeMenu {
  libelle: string;
  icone?: NomIcone;
  action: () => void;
  danger?: boolean;
  separateurAvant?: boolean;
}

/** Bouton « ⋮ » ouvrant un menu d'actions. */
export function MenuActions({
  entrees,
  libelle = 'Plus d’actions',
  icone = 'menu',
}: {
  entrees: readonly EntreeMenu[];
  libelle?: string;
  icone?: NomIcone;
}) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: PointerEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false);
    };
    const touche = (e: KeyboardEvent) => e.key === 'Escape' && setOuvert(false);
    document.addEventListener('pointerdown', fermer);
    document.addEventListener('keydown', touche);
    return () => {
      document.removeEventListener('pointerdown', fermer);
      document.removeEventListener('keydown', touche);
    };
  }, [ouvert]);
  return (
    <div ref={racine} style={{ position: 'relative' }}>
      <BoutonIcone icone={icone} libelle={libelle} aria-haspopup="menu" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)} />
      {ouvert && (
        <div className="menu" role="menu" style={{ right: 0, top: 46 }}>
          {entrees.map((e) => (
            <div key={e.libelle}>
              {e.separateurAvant && <hr />}
              <button
                type="button"
                role="menuitem"
                className={e.danger ? 'danger' : undefined}
                onClick={() => {
                  setOuvert(false);
                  e.action();
                }}
              >
                {e.icone && <Icone nom={e.icone} taille={20} />}
                {e.libelle}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EtatVide({ icone, titre, children }: { icone: NomIcone; titre: string; children?: ReactNode }) {
  return (
    <div className="vide">
      <Icone nom={icone} taille={44} epaisseur={1.5} />
      <h2 style={{ fontSize: 18, marginBottom: 6, color: 'var(--texte)' }}>{titre}</h2>
      {children}
    </div>
  );
}
