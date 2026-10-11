// Réglages : catalogue du chantier — types de murs (nom, épaisseur) et
// revêtements de sol (nom, couleur d'affichage).

import { useState } from 'react';
import { TYPE_MUR_DEFAUT_ID } from '../../model/catalogue';
import type { Projet, RevetementSol, TypeMur } from '../../model/types';
import { pluriel } from '../accueil/presentation';
import { Bouton, BoutonIcone } from '../commun/composants';
import { confirmer } from '../commun/dialogues';
import { modifierChantier, NombreCompact, TexteObligatoire } from './champs';
import {
  nouveauRevetement,
  nouveauTypeMur,
  supprimerRevetement,
  supprimerTypeMur,
  typeMurRemplacement,
  usageRevetement,
  usageTypeMur,
} from './operations';

export function SectionTypesMurs({ projet }: { projet: Projet }) {
  const types = projet.catalogue.typesMurs;
  const [ajoute, setAjoute] = useState<string | null>(null);

  const ajouter = () => {
    const t = nouveauTypeMur(projet.catalogue);
    modifierChantier((p) => void p.catalogue.typesMurs.push(t));
    setAjoute(t.id);
  };

  const supprimer = async (t: TypeMur) => {
    const usage = usageTypeMur(projet, t.id);
    if (usage > 0) {
      const remplacant = typeMurRemplacement(projet.catalogue, t.id);
      const ok = await confirmer({
        titre: `Supprimer « ${t.nom} » ?`,
        message: `Ce type de mur est utilisé dans ${pluriel(usage, 'pièce')}. Les murs concernés passeront en « ${remplacant?.nom ?? ''} ».`,
        libelleConfirmer: 'Supprimer',
        danger: true,
      });
      if (!ok) return;
    }
    modifierChantier((p) => void supprimerTypeMur(p, t.id));
  };

  const modifierType = (id: string, fn: (t: TypeMur) => void, champ?: string) =>
    modifierChantier((p) => {
      const t = p.catalogue.typesMurs.find((x) => x.id === id);
      if (t) fn(t);
    }, champ);

  return (
    <section aria-labelledby="reglages-titre-murs">
      <h2 id="reglages-titre-murs" className="titre-section">
        Types de murs
      </h2>
      <div className="carte reglages-catalogue">
        <div className="reglages-entetes reglages-grille-murs" aria-hidden="true">
          <span>Nom</span>
          <span>Épaisseur</span>
        </div>
        <ul className="reglages-lignes">
          {types.map((t) => {
            const usage = usageTypeMur(projet, t.id);
            const notes = [
              t.id === TYPE_MUR_DEFAUT_ID ? 'type des nouvelles pièces' : null,
              usage > 0 ? `utilisé dans ${pluriel(usage, 'pièce')}` : null,
            ].filter(Boolean);
            return (
              <li key={t.id} className="reglages-grille-murs">
                <TexteObligatoire
                  compact
                  libelle={`Nom du type de mur « ${t.nom} »`}
                  valeur={t.nom}
                  autoFocus={ajoute === t.id}
                  onChange={(v) => modifierType(t.id, (x) => (x.nom = v), `mur:${t.id}:nom`)}
                />
                <NombreCompact
                  libelle={`Épaisseur de « ${t.nom} »`}
                  unite="cm"
                  min={0}
                  max={150}
                  decimales={1}
                  valeur={t.epaisseur}
                  onChange={(v) => modifierType(t.id, (x) => (x.epaisseur = v))}
                />
                <BoutonIcone
                  icone="poubelle"
                  libelle={`Supprimer « ${t.nom} »`}
                  disabled={types.length <= 1}
                  onClick={() => void supprimer(t)}
                />
                {notes.length > 0 && <span className="reglages-detail reglages-note-ligne">{notes.join(' · ')}</span>}
              </li>
            );
          })}
        </ul>
        <Bouton variante="fantome" icone="plus" className="reglages-ajouter-ligne" onClick={ajouter}>
          Ajouter un type de mur
        </Bouton>
      </div>
    </section>
  );
}

export function SectionRevetements({ projet }: { projet: Projet }) {
  const revetements = projet.catalogue.revetementsSol;
  const [ajoute, setAjoute] = useState<string | null>(null);

  const ajouter = () => {
    const r = nouveauRevetement(projet.catalogue);
    modifierChantier((p) => void p.catalogue.revetementsSol.push(r));
    setAjoute(r.id);
  };

  const supprimer = async (r: RevetementSol) => {
    const usage = usageRevetement(projet, r.id);
    if (usage > 0) {
      const ok = await confirmer({
        titre: `Supprimer « ${r.nom} » ?`,
        message: `Ce revêtement est posé dans ${pluriel(usage, 'pièce')}, qui passeront en « non renseigné ».`,
        libelleConfirmer: 'Supprimer',
        danger: true,
      });
      if (!ok) return;
    }
    modifierChantier((p) => void supprimerRevetement(p, r.id));
  };

  const modifierRevetement = (id: string, fn: (r: RevetementSol) => void, champ: string) =>
    modifierChantier((p) => {
      const r = p.catalogue.revetementsSol.find((x) => x.id === id);
      if (r) fn(r);
    }, champ);

  return (
    <section aria-labelledby="reglages-titre-sols">
      <h2 id="reglages-titre-sols" className="titre-section">
        Revêtements de sol
      </h2>
      <div className="carte reglages-catalogue">
        {revetements.length === 0 && <p className="reglages-note">Aucun revêtement : les sols seront « non renseignés ».</p>}
        <ul className="reglages-lignes">
          {revetements.map((r) => {
            const usage = usageRevetement(projet, r.id);
            return (
              <li key={r.id} className="reglages-grille-sols">
                <input
                  type="color"
                  className="reglages-couleur"
                  aria-label={`Couleur de « ${r.nom} »`}
                  value={r.couleur}
                  onChange={(e) => modifierRevetement(r.id, (x) => (x.couleur = e.target.value), `sol:${r.id}:couleur`)}
                />
                <TexteObligatoire
                  compact
                  libelle={`Nom du revêtement « ${r.nom} »`}
                  valeur={r.nom}
                  autoFocus={ajoute === r.id}
                  onChange={(v) => modifierRevetement(r.id, (x) => (x.nom = v), `sol:${r.id}:nom`)}
                />
                <BoutonIcone icone="poubelle" libelle={`Supprimer « ${r.nom} »`} onClick={() => void supprimer(r)} />
                {usage > 0 && <span className="reglages-detail reglages-note-ligne">posé dans {pluriel(usage, 'pièce')}</span>}
              </li>
            );
          })}
        </ul>
        <Bouton variante="fantome" icone="plus" className="reglages-ajouter-ligne" onClick={ajouter}>
          Ajouter un revêtement
        </Bouton>
      </div>
    </section>
  );
}
