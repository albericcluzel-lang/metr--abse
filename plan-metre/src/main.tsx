import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import * as fabrique from './model/fabrique';
import { useEtat } from './store/etat';
import './styles.css';

// En développement uniquement : accès à l'état pour amorcer les tests de bout en bout.
if (import.meta.env.DEV) {
  Object.assign(window, { __etat: useEtat, __fabrique: fabrique });
}

// Mise à jour automatique de l'appli installée dès qu'une nouvelle version est publiée.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
