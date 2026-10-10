// Sauvegarde et transfert d'un chantier par fichier.
//
// Les données ne quittent jamais l'appareil d'elles-mêmes : l'export d'un
// fichier « <nom-du-chantier>-<AAAA-MM-JJ>.abse.json » (plan, réglages et
// photos) sert à la fois de sauvegarde et de transfert téléphone ↔ PC.
//
// Format (version 1) :
//   { format: 'abse-plan-metre', version: 1, exporteLe, projet,
//     photos: [{ meta: Photo, complete: dataURL, vignette: dataURL }] }
//
// À l'import, le contenu est vérifié champ par champ (messages en français)
// sans être réécrit : un champ facultatif ajouté plus tard au modèle passe tel quel.

import { maintenantIso, nouvelId } from '../model/fabrique';
import type { ID, Photo, Projet } from '../model/types';
import { useEtat } from './etat';
import * as persistance from './persistance';
import type { ImagesPhoto } from './persistance';

export const FORMAT_SAUVEGARDE = 'abse-plan-metre';
export const VERSION_SAUVEGARDE = 1;
export const EXTENSION_SAUVEGARDE = '.abse.json';
/** Types de fichiers proposés au sélecteur d'import (la version « .txt » sert au partage depuis Android). */
export const ACCEPT_IMPORT = '.json,application/json,.txt,text/plain';

export interface PhotoSauvegardee {
  meta: Photo;
  /** Image complète, en data URL base64. */
  complete: string;
  vignette: string;
}

export interface FichierSauvegarde {
  format: typeof FORMAT_SAUVEGARDE;
  version: typeof VERSION_SAUVEGARDE;
  /** Date ISO 8601 de l'export. */
  exporteLe: string;
  projet: Projet;
  photos: PhotoSauvegardee[];
}

export interface PhotoAvecImages {
  meta: Photo;
  images: ImagesPhoto;
}

/** Erreur destinée à l'utilisateur (message en français, affichable tel quel). */
export class ErreurSauvegarde extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurSauvegarde';
  }
}

// ─── Conversion Blob ↔ data URL (navigateur et Node) ─────────────────────

/** Taille des morceaux passés à String.fromCharCode (limite d'arguments des moteurs JS). */
const MORCEAU = 0x8000;

export async function blobVersDataUrl(blob: Blob): Promise<string> {
  const octets = new Uint8Array(await blob.arrayBuffer());
  let binaire = '';
  for (let i = 0; i < octets.length; i += MORCEAU) {
    binaire += String.fromCharCode(...octets.subarray(i, i + MORCEAU));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binaire)}`;
}

const ENTETE_DATA_URL = /^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)?((?:;[a-z0-9!#$&^_.+-]+=[^;,]*)*);base64$/i;

/** Lit une data URL base64 ; lève une ErreurSauvegarde si elle est invalide. */
export function dataUrlVersBlob(url: string): Blob {
  const virgule = url.indexOf(',');
  const entete = ENTETE_DATA_URL.exec(virgule > 0 ? url.slice(0, virgule) : '');
  if (!entete) throw new ErreurSauvegarde('Fichier abîmé : une image n’est pas lisible.');
  let binaire: string;
  try {
    binaire = atob(url.slice(virgule + 1));
  } catch {
    throw new ErreurSauvegarde('Fichier abîmé : une image n’est pas lisible.');
  }
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return new Blob([octets], { type: `${entete[1] ?? ''}${entete[2] ?? ''}` });
}

// ─── Export ──────────────────────────────────────────────────────────────

function deuxChiffres(n: number): string {
  return String(n).padStart(2, '0');
}

/** « Villa Dupont — Œuvre » → « villa-dupont-oeuvre » : sans accents ni espaces, sûr pour tout système de fichiers. */
export function nomPourFichier(texte: string, repli = 'chantier'): string {
  return (
    texte
      .replace(/œ/g, 'oe')
      .replace(/Œ/g, 'OE')
      .replace(/æ/g, 'ae')
      .replace(/Æ/g, 'AE')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 60)
      .replace(/-+$/, '') || repli
  );
}

/** « 2026-10-10 » (date locale). */
export function jourPourFichier(date: Date): string {
  return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}

/** « villa-dupont-2026-10-10.abse.json » (date locale du jour de l'export). */
export function nomFichierSauvegarde(nom: string, date: Date = new Date()): string {
  return `${nomPourFichier(nom)}-${jourPourFichier(date)}${EXTENSION_SAUVEGARDE}`;
}

export async function construireSauvegarde(
  projet: Projet,
  photos: readonly PhotoAvecImages[],
  exporteLe: string = maintenantIso(),
): Promise<FichierSauvegarde> {
  const liste: PhotoSauvegardee[] = [];
  for (const p of photos) {
    liste.push({
      meta: p.meta,
      complete: await blobVersDataUrl(p.images.complete),
      vignette: await blobVersDataUrl(p.images.vignette),
    });
  }
  return { format: FORMAT_SAUVEGARDE, version: VERSION_SAUVEGARDE, exporteLe, projet, photos: liste };
}

export function serialiserSauvegarde(s: FichierSauvegarde): Blob {
  return new Blob([JSON.stringify(s)], { type: 'application/json' });
}

export interface ExportChantier {
  nomFichier: string;
  blob: Blob;
  nomChantier: string;
  nombrePhotos: number;
  /** Photos dont l'image n'a pas été retrouvée sur l'appareil (non exportées). */
  photosManquantes: number;
}

/** Prépare le fichier d'export d'un chantier enregistré sur l'appareil. */
export async function exporterChantier(id: ID, date: Date = new Date()): Promise<ExportChantier> {
  // Le chantier ouvert peut avoir des modifications pas encore écrites : on part de l'état.
  const ouvert = useEtat.getState().projet;
  const projet = ouvert?.id === id ? ouvert : await persistance.lireProjet(id);
  if (!projet) throw new ErreurSauvegarde('Ce chantier n’existe plus sur cet appareil.');
  const photos: PhotoAvecImages[] = [];
  let photosManquantes = 0;
  for (const meta of await persistance.listerPhotos(id)) {
    const images = await persistance.lireImages(meta.id);
    if (images) photos.push({ meta, images });
    else photosManquantes++;
  }
  const sauvegarde = await construireSauvegarde(projet, photos, date.toISOString());
  return {
    nomFichier: nomFichierSauvegarde(projet.nom, date),
    blob: serialiserSauvegarde(sauvegarde),
    nomChantier: projet.nom,
    nombrePhotos: photos.length,
    photosManquantes,
  };
}

// ─── Lecture et validation ───────────────────────────────────────────────

const MESSAGE_ILLISIBLE =
  'Fichier illisible : ce n’est pas un fichier de chantier ABSE (contenu abîmé ou d’un autre type).';
const MESSAGE_AUTRE_FORMAT = 'Ce fichier n’est pas une sauvegarde de chantier ABSE Plan & Métré.';

function messageVersionFuture(version: number): string {
  return `Ce fichier a été créé par une version plus récente de l’appli (format ${version}). Mettez l’appli à jour (fermez-la puis rouvrez-la avec le réseau) et réessayez.`;
}

type Objet = Record<string, unknown>;

function echec(chemin: string): never {
  throw new ErreurSauvegarde(`Fichier incomplet ou abîmé : donnée invalide (${chemin}).`);
}

function estObjet(v: unknown): v is Objet {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function objet(v: unknown, chemin: string): Objet {
  if (!estObjet(v)) echec(chemin);
  return v;
}

function tableau(v: unknown, chemin: string): unknown[] {
  if (!Array.isArray(v)) echec(chemin);
  return v;
}

function texte(v: unknown, chemin: string): string {
  if (typeof v !== 'string') echec(chemin);
  return v;
}

function identifiant(v: unknown, chemin: string): string {
  if (typeof v !== 'string' || v.length === 0) echec(chemin);
  return v;
}

function identifiantOuNull(v: unknown, chemin: string): void {
  if (v !== null) identifiant(v, chemin);
}

function nombre(v: unknown, chemin: string, min = -Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) echec(chemin);
  return v;
}

function booleen(v: unknown, chemin: string): void {
  if (typeof v !== 'boolean') echec(chemin);
}

function date(v: unknown, chemin: string): void {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) echec(chemin);
}

function parmi(v: unknown, valeurs: readonly string[], chemin: string): void {
  if (typeof v !== 'string' || !valeurs.includes(v)) echec(chemin);
}

function point(v: unknown, chemin: string): void {
  const p = objet(v, chemin);
  nombre(p.x, `${chemin}.x`);
  nombre(p.y, `${chemin}.y`);
}

function idsUniques(ids: readonly string[], chemin: string): void {
  if (new Set(ids).size !== ids.length) echec(`${chemin} : identifiants en double`);
}

const TYPES_OUVERTURES = ['porte', 'porte-fenetre', 'fenetre', 'baie', 'passage'] as const;
const TYPES_EQUIPEMENTS = [
  'baignoire',
  'douche',
  'meuble-vasque',
  'lavabo',
  'wc',
  'evier',
  'meuble-cuisine',
  'placard',
  'radiateur',
  'ballon-ecs',
  'autre',
] as const;

function verifierPiece(v: unknown, c: string): void {
  const p = objet(v, c);
  identifiant(p.id, `${c}.id`);
  texte(p.nom, `${c}.nom`);
  const sommets = tableau(p.sommets, `${c}.sommets`);
  if (sommets.length < 3) echec(`${c}.sommets`);
  sommets.forEach((s, i) => {
    point(s, `${c}.sommets[${i}]`);
    const t = (s as Objet).typeMurId;
    if (t !== undefined) identifiantOuNull(t, `${c}.sommets[${i}].typeMurId`);
  });
  nombre(p.hauteur, `${c}.hauteur`, 0);
  identifiant(p.typeMurDefautId, `${c}.typeMurDefautId`);
  identifiantOuNull(p.revetementSolId, `${c}.revetementSolId`);
  booleen(p.plafondAPeindre, `${c}.plafondAPeindre`);
  tableau(p.ouvertures, `${c}.ouvertures`).forEach((x, i) => {
    const co = `${c}.ouvertures[${i}]`;
    const o = objet(x, co);
    identifiant(o.id, `${co}.id`);
    parmi(o.type, TYPES_OUVERTURES, `${co}.type`);
    const cote = nombre(o.cote, `${co}.cote`, 0);
    if (!Number.isInteger(cote)) echec(`${co}.cote`);
    nombre(o.position, `${co}.position`);
    nombre(o.largeur, `${co}.largeur`, 0);
    nombre(o.hauteur, `${co}.hauteur`, 0);
    nombre(o.allege, `${co}.allege`);
    if (o.charniere !== undefined) parmi(o.charniere, ['debut', 'fin'], `${co}.charniere`);
    if (o.versInterieur !== undefined) booleen(o.versInterieur, `${co}.versInterieur`);
  });
  tableau(p.equipements, `${c}.equipements`).forEach((x, i) => {
    const ce = `${c}.equipements[${i}]`;
    const e = objet(x, ce);
    identifiant(e.id, `${ce}.id`);
    parmi(e.type, TYPES_EQUIPEMENTS, `${ce}.type`);
    texte(e.nom, `${ce}.nom`);
    for (const k of ['x', 'y', 'rotation'] as const) nombre(e[k], `${ce}.${k}`);
    for (const k of ['largeur', 'profondeur', 'hauteur'] as const) nombre(e[k], `${ce}.${k}`, 0);
    booleen(e.deduireSol, `${ce}.deduireSol`);
  });
}

function verifierPlan(v: unknown, c: string): void {
  const plan = objet(v, c);
  const pieces = tableau(plan.pieces, `${c}.pieces`);
  pieces.forEach((p, i) => verifierPiece(p, `${c}.pieces[${i}]`));
  idsUniques(
    pieces.map((p) => (p as Objet).id as string),
    `${c}.pieces`,
  );
}

function verifierProjet(v: unknown): void {
  const p = objet(v, 'projet');
  if (p.version !== 1) {
    if (typeof p.version === 'number' && p.version > 1) throw new ErreurSauvegarde(messageVersionFuture(p.version));
    echec('projet.version');
  }
  identifiant(p.id, 'projet.id');
  for (const k of ['nom', 'client', 'adresse', 'notes'] as const) texte(p[k], `projet.${k}`);
  date(p.creeLe, 'projet.creeLe');
  date(p.modifieLe, 'projet.modifieLe');

  const niveaux = tableau(p.niveaux, 'projet.niveaux');
  if (niveaux.length === 0) echec('projet.niveaux : aucun niveau');
  niveaux.forEach((x, i) => {
    const c = `projet.niveaux[${i}]`;
    const n = objet(x, c);
    identifiant(n.id, `${c}.id`);
    texte(n.nom, `${c}.nom`);
    nombre(n.ordre, `${c}.ordre`);
    nombre(n.hauteurDefaut, `${c}.hauteurDefaut`, 0);
    verifierPlan(n.actuel, `${c}.actuel`);
    if (n.renove !== null) verifierPlan(n.renove, `${c}.renove`);
  });
  idsUniques(
    niveaux.map((n) => (n as Objet).id as string),
    'projet.niveaux',
  );

  const cat = objet(p.catalogue, 'projet.catalogue');
  const murs = tableau(cat.typesMurs, 'projet.catalogue.typesMurs');
  murs.forEach((x, i) => {
    const c = `projet.catalogue.typesMurs[${i}]`;
    const t = objet(x, c);
    identifiant(t.id, `${c}.id`);
    texte(t.nom, `${c}.nom`);
    nombre(t.epaisseur, `${c}.epaisseur`, 0);
  });
  idsUniques(
    murs.map((t) => (t as Objet).id as string),
    'projet.catalogue.typesMurs',
  );
  const sols = tableau(cat.revetementsSol, 'projet.catalogue.revetementsSol');
  sols.forEach((x, i) => {
    const c = `projet.catalogue.revetementsSol[${i}]`;
    const r = objet(x, c);
    identifiant(r.id, `${c}.id`);
    texte(r.nom, `${c}.nom`);
    if (!/^#[0-9a-f]{6}$/i.test(texte(r.couleur, `${c}.couleur`))) echec(`${c}.couleur`);
  });
  idsUniques(
    sols.map((r) => (r as Objet).id as string),
    'projet.catalogue.revetementsSol',
  );

  const par = objet(p.parametres, 'projet.parametres');
  booleen(par.deduireOuvertures, 'projet.parametres.deduireOuvertures');
  nombre(par.seuilDeductionOuverture, 'projet.parametres.seuilDeductionOuverture', 0);
}

function verifierPhoto(v: unknown, i: number): void {
  const c = `photos[${i}]`;
  const ph = objet(v, c);
  const m = objet(ph.meta, `${c}.meta`);
  identifiant(m.id, `${c}.meta.id`);
  texte(m.projetId, `${c}.meta.projetId`);
  identifiantOuNull(m.niveauId, `${c}.meta.niveauId`);
  identifiantOuNull(m.pieceId, `${c}.meta.pieceId`);
  if (m.position !== null) point(m.position, `${c}.meta.position`);
  texte(m.legende, `${c}.meta.legende`);
  date(m.date, `${c}.meta.date`);
  nombre(m.largeur, `${c}.meta.largeur`, 0);
  nombre(m.hauteur, `${c}.meta.hauteur`, 0);
  for (const k of ['complete', 'vignette'] as const) {
    if (typeof ph[k] !== 'string' || !(ph[k] as string).startsWith('data:')) echec(`${c}.${k}`);
  }
}

/** Vérifie la structure d'une sauvegarde déjà décodée (JSON.parse). */
export function validerSauvegarde(d: unknown): FichierSauvegarde {
  if (!estObjet(d)) throw new ErreurSauvegarde(MESSAGE_ILLISIBLE);
  if (d.format !== FORMAT_SAUVEGARDE) throw new ErreurSauvegarde(MESSAGE_AUTRE_FORMAT);
  if (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 1) {
    throw new ErreurSauvegarde('Version de fichier inconnue : ce fichier n’est pas une sauvegarde valide.');
  }
  if (d.version > VERSION_SAUVEGARDE) throw new ErreurSauvegarde(messageVersionFuture(d.version));
  date(d.exporteLe, 'exporteLe');
  verifierProjet(d.projet);
  const photos = tableau(d.photos, 'photos');
  photos.forEach(verifierPhoto);
  idsUniques(
    photos.map((p) => ((p as Objet).meta as Objet).id as string),
    'photos',
  );
  return d as unknown as FichierSauvegarde;
}

/** Lit le texte d'un fichier de sauvegarde ; lève une ErreurSauvegarde au message affichable. */
export function lireSauvegarde(contenu: string): FichierSauvegarde {
  let donnees: unknown;
  try {
    // Certains éditeurs ajoutent une marque d'ordre des octets en tête.
    donnees = JSON.parse(contenu.replace(/^﻿/, ''));
  } catch {
    throw new ErreurSauvegarde(MESSAGE_ILLISIBLE);
  }
  return validerSauvegarde(donnees);
}

export async function lireFichierSauvegarde(fichier: Blob): Promise<FichierSauvegarde> {
  let contenu: string;
  try {
    contenu = await fichier.text();
  } catch {
    throw new ErreurSauvegarde(MESSAGE_ILLISIBLE);
  }
  return lireSauvegarde(contenu);
}

// ─── Import ──────────────────────────────────────────────────────────────

/**
 * nouveau   : le chantier n'existe pas sur l'appareil, il garde ses identifiants ;
 * remplacer : le chantier existant (même identifiant) est remplacé, photos comprises ;
 * copie     : nouveaux identifiants de chantier et de photos, nom suffixé « (copie) ».
 */
export type ModeImport = 'nouveau' | 'remplacer' | 'copie';

/** « Villa (copie) », puis « Villa (copie 2) »… si le nom est déjà pris. */
export function nomCopie(nom: string, nomsExistants: readonly string[]): string {
  const base = nom.replace(/\s*\(copie(?: \d+)?\)$/, '') || nom;
  const pris = new Set(nomsExistants);
  let candidat = `${base} (copie)`;
  for (let n = 2; pris.has(candidat); n++) candidat = `${base} (copie ${n})`;
  return candidat;
}

export interface ImportPrepare {
  projet: Projet;
  photos: PhotoAvecImages[];
}

/** Construit le chantier et les photos à enregistrer, sans rien écrire. */
export function preparerImport(
  s: FichierSauvegarde,
  options: { copie: boolean; nomsExistants?: readonly string[]; maintenant?: string },
): ImportPrepare {
  const projet = structuredClone(s.projet);
  if (options.copie) {
    projet.id = nouvelId();
    projet.nom = nomCopie(projet.nom, options.nomsExistants ?? []);
    projet.creeLe = projet.modifieLe = options.maintenant ?? maintenantIso();
  }
  const photos = s.photos.map((p) => ({
    meta: { ...structuredClone(p.meta), id: options.copie ? nouvelId() : p.meta.id, projetId: projet.id },
    images: { complete: dataUrlVersBlob(p.complete), vignette: dataUrlVersBlob(p.vignette) },
  }));
  return { projet, photos };
}

/** Le chantier de cette sauvegarde existe-t-il déjà sur l'appareil ? */
export async function chantierExiste(id: ID): Promise<boolean> {
  return useEtat.getState().projets.some((p) => p.id === id) || (await persistance.lireProjet(id)) !== undefined;
}

/**
 * Enregistre la sauvegarde sur l'appareil (chantier et photos). Les photos
 * sont écrites d'abord : le chantier n'apparaît dans la liste qu'une fois
 * complet, et un échec en cours de route ne laisse pas de photos orphelines.
 */
export async function importerSauvegarde(s: FichierSauvegarde, mode: ModeImport): Promise<Projet> {
  const { projet, photos } = preparerImport(s, {
    copie: mode === 'copie',
    nomsExistants: useEtat.getState().projets.map((p) => p.nom),
  });
  const existe = await chantierExiste(projet.id);
  if (mode === 'nouveau' && existe) {
    throw new ErreurSauvegarde('Ce chantier existe déjà sur cet appareil : choisissez « Remplacer » ou « Importer comme copie ».');
  }

  const anciennes = mode === 'remplacer' && existe ? await persistance.listerPhotos(projet.id) : [];
  if (mode === 'remplacer' && useEtat.getState().projet?.id === projet.id) {
    // Le chantier remplacé est ouvert : on écrit ce qui est en attente puis on le ferme,
    // pour que l'ancienne version gardée en mémoire n'écrase pas l'import.
    await useEtat.getState().enregistrerMaintenant();
    useEtat.getState().fermerProjet();
  }

  const idsAnciens = new Set(anciennes.map((p) => p.id));
  const ecrites: ID[] = [];
  try {
    for (const p of photos) {
      await persistance.enregistrerPhoto(p.meta, p.images);
      ecrites.push(p.meta.id);
    }
  } catch (e) {
    console.error('Import interrompu', e);
    for (const id of ecrites) if (!idsAnciens.has(id)) await persistance.supprimerPhoto(id).catch(() => undefined);
    throw new ErreurSauvegarde('Import interrompu : l’espace de stockage de l’appareil est peut-être plein.');
  }
  const nouvelles = new Set(photos.map((p) => p.meta.id));
  for (const ancienne of anciennes) {
    if (!nouvelles.has(ancienne.id)) await persistance.supprimerPhoto(ancienne.id);
  }
  await useEtat.getState().importerProjet(projet);
  return projet;
}

// ─── Fichier vers l'extérieur (navigateur uniquement) ────────────────────

/** Télécharge un fichier (dossier Téléchargements du téléphone ou du PC). */
export function telechargerFichier(blob: Blob, nomFichier: string): void {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  lien.rel = 'noopener';
  lien.style.display = 'none';
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  // Libérée plus tard : certains navigateurs lisent l'URL après le clic.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Le navigateur sait-il partager des fichiers (Web Share : mail, WhatsApp, Drive…) ? */
export function partageFichiersDisponible(): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
      return false;
    }
    return navigator.canShare({ files: [new File(['ABSE'], 'test.txt', { type: 'text/plain' })] });
  } catch {
    return false;
  }
}

/**
 * Versions partageables du fichier de sauvegarde, par ordre de préférence.
 * Chrome n'accepte qu'une liste fermée de types de fichiers à partager, dont
 * le JSON ne fait pas partie sur Android : la version « .abse.json.txt »
 * (texte brut, même contenu) passe partout et se réimporte telle quelle.
 */
export function fichiersPartageables(blob: Blob, nomFichier: string): File[] {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return [];
  const candidats = [
    new File([blob], nomFichier, { type: 'application/json' }),
    new File([blob], `${nomFichier}.txt`, { type: 'text/plain' }),
  ];
  return candidats.filter((f) => {
    try {
      return navigator.canShare({ files: [f] });
    } catch {
      return false;
    }
  });
}
