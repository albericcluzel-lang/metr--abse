// Mise en forme de la liste des chantiers (logique pure, testée).

import { boiteEnglobante } from '../../geometrie/polygone';
import { formaterValeur, metreProjet } from '../../metre/calcul';
import type { Projet } from '../../model/types';

/** « 0 pièce », « 1 pièce », « 2 pièces » (règle française : pluriel à partir de 2). */
export function pluriel(n: number, singulier: string, formePlurielle = `${singulier}s`): string {
  return `${n} ${n >= 2 ? formePlurielle : singulier}`;
}

function debutDuJour(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** « Modifié aujourd’hui à 10:13 », « Modifié hier à 18:02 », « Modifié le 1er octobre ». */
export function formaterModification(iso: string, maintenant: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Arrondi : les jours de changement d'heure font 23 ou 25 heures.
  const ecart = Math.round((debutDuJour(maintenant) - debutDuJour(d)) / 86_400_000);
  if (ecart === 0) return `Modifié aujourd’hui à ${heure}`;
  if (ecart === 1) return `Modifié hier à ${heure}`;
  const jour = d.getDate() === 1 ? '1er' : String(d.getDate());
  const mois = d.toLocaleDateString('fr-FR', { month: 'long' });
  const annee = d.getFullYear() === maintenant.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `Modifié le ${jour} ${mois}${annee}`;
}

export interface ResumeChantier {
  niveaux: number;
  pieces: number;
  /** Surface au sol du plan actuel (m²). */
  surface: number;
}

export function resumerChantier(p: Projet): ResumeChantier {
  return {
    niveaux: p.niveaux.length,
    pieces: p.niveaux.reduce((n, niv) => n + niv.actuel.pieces.length, 0),
    surface: metreProjet(p, 'actuel').global.surfaceSol / 1e4,
  };
}

/** « 2 niveaux · 5 pièces · 84,20 m² » (surface omise tant qu'aucune pièce n'est dessinée). */
export function detailChantier(r: ResumeChantier): string {
  const morceaux = [pluriel(r.niveaux, 'niveau', 'niveaux'), pluriel(r.pieces, 'pièce')];
  if (r.pieces > 0) morceaux.push(formaterValeur(r.surface, 'm²'));
  return morceaux.join(' · ');
}

/** Minuscules sans accents, pour une recherche tolérante. */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Chantiers dont le nom, le client ou l'adresse contiennent tous les mots cherchés. */
export function filtrerChantiers(projets: readonly Projet[], recherche: string): Projet[] {
  const mots = normaliser(recherche).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return [...projets];
  return projets.filter((p) => {
    const texte = normaliser(`${p.nom} ${p.client} ${p.adresse}`);
    return mots.every((m) => texte.includes(m));
  });
}

/** Du plus récemment modifié au plus ancien. */
export function trierChantiers(projets: readonly Projet[]): Projet[] {
  return [...projets].sort((a, b) => b.modifieLe.localeCompare(a.modifieLe));
}

/** « 850 ko », « 12,4 Mo », « 1,25 Go ». */
export function formaterOctets(octets: number): string {
  const nombre = (v: number, decimales: number) =>
    new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimales }).format(v);
  if (!Number.isFinite(octets) || octets < 0) return '';
  if (octets < 1024 * 1024) return `${nombre(Math.max(1, Math.round(octets / 1024)), 0)} ko`;
  if (octets < 1024 ** 3) return `${nombre(octets / 1024 ** 2, 1)} Mo`;
  return `${nombre(octets / 1024 ** 3, 2)} Go`;
}

export interface ApercuPlan {
  viewBox: string;
  pieces: { id: string; points: string; couleur: string | null }[];
}

/**
 * Petit aperçu du plan actuel pour la carte du chantier : le niveau qui a le
 * plus de pièces (le plus bas en cas d'égalité). null si rien n'est dessiné.
 */
export function apercuPlan(p: Projet): ApercuPlan | null {
  const niveau = [...p.niveaux]
    .sort((a, b) => a.ordre - b.ordre)
    .reduce<Projet['niveaux'][number] | null>(
      (meilleur, n) => (n.actuel.pieces.length > (meilleur?.actuel.pieces.length ?? 0) ? n : meilleur),
      null,
    );
  const pieces = niveau?.actuel.pieces.filter((x) => x.sommets.length >= 3) ?? [];
  if (pieces.length === 0) return null;
  const b = boiteEnglobante(pieces.flatMap((x) => x.sommets));
  const cote = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
  const marge = cote * 0.08;
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    viewBox: [b.minX - marge, b.minY - marge, b.maxX - b.minX + 2 * marge, b.maxY - b.minY + 2 * marge].map(r).join(' '),
    pieces: pieces.map((x) => ({
      id: x.id,
      points: x.sommets.map((s) => `${r(s.x)},${r(s.y)}`).join(' '),
      couleur: p.catalogue.revetementsSol.find((rv) => rv.id === x.revetementSolId)?.couleur ?? null,
    })),
  };
}
