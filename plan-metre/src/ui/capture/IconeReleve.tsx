// Icônes propres au relevé (même style que ui/commun/Icone : trait 24 × 24).

const CHEMINS = {
  'virage-droite': 'M6 20v-7a5 5 0 015-5h8M15 4l4 4-4 4',
  'virage-gauche': 'M18 20v-7a5 5 0 00-5-5H5M9 4L5 8l4 4',
  'angle-libre': 'M4 19h16M4 19L15 6M10.5 19a6.5 6.5 0 00-2-4.6',
  'realite-augmentee':
    'M7 3H5a2 2 0 00-2 2v2M17 3h2a2 2 0 012 2v2M7 21H5a2 2 0 01-2-2v-2M17 21h2a2 2 0 002-2v-2M12 7l5 2.8v5.4L12 18l-5-2.8V9.8L12 7zM12 12.6V18M12 12.6l5-2.8M12 12.6L7 9.8',
  angle: 'M12 21a2 2 0 100-4 2 2 0 000 4zM4 19h6M14 19h6M12 3v12',
  hauteur: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4M3 3h18M3 21h18',
  quitter: 'M18 6L6 18M6 6l12 12',
} as const;

export type NomIconeReleve = keyof typeof CHEMINS;

export function IconeReleve({ nom, taille = 22, epaisseur = 2 }: { nom: NomIconeReleve; taille?: number; epaisseur?: number }) {
  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={epaisseur}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={CHEMINS[nom]} />
    </svg>
  );
}
