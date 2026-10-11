import type {
  Catalogue,
  ParametresMetre,
  TypeEquipement,
  TypeOuverture,
} from './types';

/** Catalogue proposé à la création d'un chantier (modifiable ensuite). */
export function catalogueParDefaut(): Catalogue {
  return {
    typesMurs: [
      { id: 'cloison-72', nom: 'Cloison 72 mm', epaisseur: 7.2 },
      { id: 'cloison-98', nom: 'Cloison 98 mm', epaisseur: 9.8 },
      { id: 'cloison-140', nom: 'Cloison 140 mm', epaisseur: 14 },
      { id: 'carreau-platre-70', nom: 'Carreaux de plâtre 70 mm', epaisseur: 7 },
      { id: 'mur-parpaing-20', nom: 'Mur parpaing 20 cm', epaisseur: 20 },
      { id: 'mur-beton-18', nom: 'Mur béton 18 cm', epaisseur: 18 },
      { id: 'mur-brique-20', nom: 'Mur brique 20 cm', epaisseur: 20 },
      { id: 'mur-pierre-40', nom: 'Mur pierre 40 cm', epaisseur: 40 },
    ],
    revetementsSol: [
      { id: 'carrelage', nom: 'Carrelage', couleur: '#d9cdb8' },
      { id: 'parquet', nom: 'Parquet', couleur: '#c89f6d' },
      { id: 'stratifie', nom: 'Stratifié', couleur: '#d2b48c' },
      { id: 'pvc', nom: 'Sol PVC / LVT', couleur: '#b9c3c9' },
      { id: 'moquette', nom: 'Moquette', couleur: '#a7a9c8' },
      { id: 'beton-cire', nom: 'Béton ciré', couleur: '#a9a9a9' },
    ],
  };
}

export const TYPE_MUR_DEFAUT_ID = 'cloison-98';

export function parametresParDefaut(): ParametresMetre {
  return { deduireOuvertures: true, seuilDeductionOuverture: 0 };
}

export interface ModeleOuverture {
  libelle: string;
  largeur: number;
  hauteur: number;
  allege: number;
}

/** Dimensions proposées à l'ajout d'une ouverture (cm). */
export const MODELES_OUVERTURES: Record<TypeOuverture, ModeleOuverture> = {
  porte: { libelle: 'Porte', largeur: 83, hauteur: 204, allege: 0 },
  'porte-fenetre': { libelle: 'Porte-fenêtre', largeur: 120, hauteur: 215, allege: 0 },
  fenetre: { libelle: 'Fenêtre', largeur: 100, hauteur: 125, allege: 95 },
  baie: { libelle: 'Baie vitrée', largeur: 240, hauteur: 215, allege: 0 },
  passage: { libelle: 'Passage libre', largeur: 90, hauteur: 204, allege: 0 },
};

/** Ouvertures qui descendent jusqu'au sol (interrompent les plinthes). */
export function ouvertureAuSol(allege: number): boolean {
  return allege <= 0;
}

export interface ModeleEquipement {
  libelle: string;
  largeur: number;
  profondeur: number;
  hauteur: number;
  deduireSol: boolean;
}

/** Dimensions proposées à l'ajout d'un équipement (cm). */
export const MODELES_EQUIPEMENTS: Record<TypeEquipement, ModeleEquipement> = {
  baignoire: { libelle: 'Baignoire', largeur: 170, profondeur: 70, hauteur: 55, deduireSol: true },
  douche: { libelle: 'Receveur de douche', largeur: 90, profondeur: 90, hauteur: 10, deduireSol: true },
  'meuble-vasque': { libelle: 'Meuble vasque', largeur: 80, profondeur: 46, hauteur: 85, deduireSol: true },
  lavabo: { libelle: 'Lavabo suspendu', largeur: 55, profondeur: 45, hauteur: 85, deduireSol: false },
  wc: { libelle: 'WC', largeur: 38, profondeur: 65, hauteur: 80, deduireSol: false },
  evier: { libelle: 'Meuble évier', largeur: 120, profondeur: 60, hauteur: 90, deduireSol: true },
  'meuble-cuisine': { libelle: 'Meuble de cuisine', largeur: 60, profondeur: 60, hauteur: 90, deduireSol: true },
  placard: { libelle: 'Placard', largeur: 100, profondeur: 60, hauteur: 250, deduireSol: true },
  radiateur: { libelle: 'Radiateur', largeur: 80, profondeur: 10, hauteur: 60, deduireSol: false },
  'ballon-ecs': { libelle: 'Ballon d’eau chaude', largeur: 60, profondeur: 60, hauteur: 150, deduireSol: true },
  autre: { libelle: 'Autre', largeur: 60, profondeur: 60, hauteur: 80, deduireSol: false },
};

/** Noms de pièces proposés à la saisie. */
export const NOMS_PIECES = [
  'Séjour',
  'Salon',
  'Salle à manger',
  'Cuisine',
  'Chambre',
  'Salle de bain',
  "Salle d'eau",
  'WC',
  'Entrée',
  'Dégagement',
  'Couloir',
  'Bureau',
  'Buanderie',
  'Cellier',
  'Dressing',
  'Garage',
];
