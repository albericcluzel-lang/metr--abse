// Guide du métré : comment chaque quantité est calculée (règles du moteur
// metre/calcul.ts) et effet des réglages du chantier.

import type { ParametresMetre } from '../../model/types';
import { formaterValeur } from '../../metre/calcul';
import { Bouton, FeuilleBas } from '../commun/composants';

const REGLES: { titre: string; texte: string }[] = [
  {
    titre: 'Surface au sol',
    texte: 'Aire du contour intérieur de la pièce, mesurée au nu des murs.',
  },
  {
    titre: 'Surfaces murs et cloisons',
    texte:
      'Longueur de chaque côté qui porte un mur × hauteur sous plafond, une seule face, regroupée par type de mur. ' +
      'Surface brute : les ouvertures ne sont pas retirées. Un côté « sans mur » (pièce ouverte sur une autre) ne compte pas.',
  },
  {
    titre: 'Surfaces à peindre',
    texte:
      'Murs ci-dessus moins les portes, fenêtres et passages (selon les réglages ci-dessous), ' +
      'plus le plafond (égal à la surface au sol) si la pièce le demande.',
  },
  {
    titre: 'Volume',
    texte: 'Surface au sol × hauteur sous plafond.',
  },
  {
    titre: 'Circonférences',
    texte:
      'Intérieure : tour de la pièce au nu des murs. Extérieure : même tour, élargi de l’épaisseur des murs. ' +
      'Plinthes : longueur des côtés avec mur, moins la largeur des ouvertures qui descendent jusqu’au sol (portes, baies, passages).',
  },
  {
    titre: 'Revêtements de sol',
    texte:
      'Surface au sol moins l’emprise des équipements marqués « déduits du sol » (baignoire, receveur, meubles…). ' +
      'Seule la partie de l’équipement à l’intérieur de la pièce est retirée.',
  },
  {
    titre: 'Menuiseries et ouvertures',
    texte: 'Nombre d’ouvertures par type et par dimensions (largeur × hauteur).',
  },
  {
    titre: 'Murs mitoyens',
    texte:
      'Une ouverture traverse le mur : elle est aussi retirée de la face du même mur dans la pièce voisine ' +
      '(détectée automatiquement), sans être comptée deux fois dans les menuiseries.',
  },
  {
    titre: 'Plan actuel et plan rénové',
    texte:
      'Le plan rénové se crée depuis l’écran du plan. Un niveau sans plan rénové est réputé inchangé : ' +
      'son métré rénové est celui du plan actuel. « Comparer » affiche l’écart rénové − actuel.',
  },
  {
    titre: 'Arrondis',
    texte:
      'Les valeurs sont arrondies au centième à l’affichage ; les totaux sont calculés sur les valeurs exactes, ' +
      'ils peuvent donc différer d’un centième de la somme des lignes.',
  },
];

function texteReglages(p: ParametresMetre): string {
  if (!p.deduireOuvertures) {
    return 'Les ouvertures ne sont pas déduites : les surfaces à peindre sont égales aux surfaces de murs (plafond en plus).';
  }
  const seuil = Math.max(0, p.seuilDeductionOuverture);
  if (seuil <= 0) return 'Toutes les ouvertures sont déduites des surfaces à peindre (« hors ouvrants »).';
  return `Les ouvertures de plus de ${formaterValeur(seuil, 'm²')} sont déduites des surfaces à peindre ; les plus petites restent comptées comme du mur.`;
}

export function GuideMetre({
  ouvert,
  onFermer,
  parametres,
  onReglages,
}: {
  ouvert: boolean;
  onFermer: () => void;
  parametres: ParametresMetre;
  onReglages: () => void;
}) {
  return (
    <FeuilleBas
      ouverte={ouvert}
      titre="Guide du métré"
      onFermer={onFermer}
      pied={
        <Bouton variante="secondaire" icone="parametres" onClick={onReglages}>
          Modifier les réglages
        </Bouton>
      }
    >
      <div className="metre-guide">
        <p className="metre-guide-intro">
          Le métré est calculé automatiquement à partir du plan. Voici comment chaque quantité est obtenue.
        </p>
        <dl className="metre-guide-regles">
          {REGLES.map((r) => (
            <div key={r.titre} className="metre-guide-regle">
              <dt>{r.titre}</dt>
              <dd>{r.texte}</dd>
            </div>
          ))}
        </dl>
        <h3 className="metre-guide-titre">Réglages de ce chantier</h3>
        <ul className="metre-guide-reglages">
          <li>
            <strong>Déduire les ouvertures</strong> : {parametres.deduireOuvertures ? 'activé' : 'désactivé'}. Activé, les surfaces
            à peindre sont données « hors ouvrants » ; désactivé, les ouvertures restent comptées comme du mur.
          </li>
          <li>
            <strong>Seuil de déduction</strong> : {formaterValeur(Math.max(0, parametres.seuilDeductionOuverture), 'm²')}. Les
            ouvertures dont la surface ne dépasse pas ce seuil ne sont pas déduites (0 = toutes sont déduites).
          </li>
        </ul>
        <p className="metre-guide-etat">{texteReglages(parametres)}</p>
      </div>
    </FeuilleBas>
  );
}
