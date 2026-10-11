import { useEffect } from 'react';
import { brancherEnregistrementAutomatique, useEtat } from './store/etat';
import { EcranAccueil } from './ui/accueil/EcranAccueil';
import { EcranReleve } from './ui/capture/EcranReleve';
import { HoteDialogues } from './ui/commun/dialogues';
import { EcranChantier } from './ui/EcranChantier';
import { EcranMetre } from './ui/metre/EcranMetre';
import { EcranParametres } from './ui/parametres/EcranParametres';
import { EcranPhotos } from './ui/photos/EcranPhotos';
import { useRoute } from './ui/routeur';

export function App() {
  const pret = useEtat((e) => e.pret);
  const route = useRoute();

  useEffect(() => {
    void useEtat.getState().initialiser();
    return brancherEnregistrementAutomatique();
  }, []);

  if (!pret) return <div className="chargement">Chargement…</div>;

  let ecran;
  switch (route.ecran) {
    case 'accueil':
      ecran = <EcranAccueil />;
      break;
    case 'chantier':
      ecran = <EcranChantier id={route.id} />;
      break;
    case 'releve':
      ecran = <EcranReleve id={route.id} />;
      break;
    case 'metre':
      ecran = <EcranMetre id={route.id} />;
      break;
    case 'photos':
      ecran = <EcranPhotos id={route.id} />;
      break;
    case 'parametres':
      ecran = <EcranParametres id={route.id} />;
      break;
  }
  return (
    <>
      {ecran}
      <HoteDialogues />
    </>
  );
}
