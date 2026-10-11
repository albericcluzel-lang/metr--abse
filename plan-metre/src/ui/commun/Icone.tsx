// Jeu d'icônes au trait (24 × 24), intégré pour fonctionner hors ligne.

const CHEMINS = {
  retour: 'M15 18l-6-6 6-6',
  suivant: 'M9 18l6-6-6-6',
  bas: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  moins: 'M5 12h14',
  fermer: 'M18 6L6 18M6 6l12 12',
  valider: 'M20 6L9 17l-5-5',
  menu: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
  annuler: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  retablir: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  cube: 'M12 2l9 5v10l-9 5-9-5V7l9-5zM12 22V12M21 7l-9 5-9-5',
  plan: 'M3 3h18v18H3zM3 12h9M12 3v18M12 15h9',
  photo: 'M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1zM12 17a4 4 0 100-8 4 4 0 000 8z',
  metre: 'M3 17l14-14 4 4L7 21l-4-4zM7 13l2 2M10 10l2 2M13 7l2 2',
  poubelle: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  crayon: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  niveaux: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  maison: 'M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5',
  telecharger: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  televerser: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  partager: 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6z',
  porte: 'M5 21V4h10v17M15 4l4 2v15M12 13h.01M3 21h18',
  fenetre: 'M4 4h16v16H4zM12 4v16M4 12h16',
  rotation: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  dupliquer: 'M9 9h11v11H9zM5 15H4V4h11v1',
  cible: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 15a3 3 0 100-6 3 3 0 000 6zM12 1v4M12 19v4M1 12h4M19 12h4',
  regle: 'M2 8h20v8H2zM6 8v3M10 8v4M14 8v3M18 8v4',
  ajuster: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  oeil: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  parametres: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-5M12 8h.01',
  alerte: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  main: 'M8 13V5.5a1.5 1.5 0 013 0V12M11 11.5v-7a1.5 1.5 0 013 0V12M14 12V6.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L3 14.5a1.5 1.5 0 012.4-1.8L8 15',
  selection: 'M5 3l14 8-6 2-3 6-5-16z',
  equipement: 'M3 10h18v6H3zM5 16v3M19 16v3M6 10V7a2 2 0 012-2h8a2 2 0 012 2v3',
  sommet: 'M12 15a3 3 0 100-6 3 3 0 000 6zM3 12h6M15 12h6',
  epingle: 'M12 22s7-6.1 7-12a7 7 0 10-14 0c0 5.9 7 12 7 12zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  aide: 'M12 22a10 10 0 100-20 10 10 0 000 20zM9.5 9a2.5 2.5 0 114 2c-.8.6-1.5 1.2-1.5 2.5M12 17h.01',
  dossier: 'M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6z',
  laser: 'M3 9h10v6H3zM13 12h8M17 9l4 3-4 3M6 12h.01',
  rectangle: 'M4 6h16v12H4z',
  imprimer: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z',
} as const;

export type NomIcone = keyof typeof CHEMINS;

export function Icone({ nom, taille = 22, epaisseur = 2 }: { nom: NomIcone; taille?: number; epaisseur?: number }) {
  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={nom === 'menu' ? 3 : epaisseur}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={CHEMINS[nom]} />
    </svg>
  );
}
