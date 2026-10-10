// Confirmations et notifications éphémères, appelables depuis n'importe où :
//   if (await confirmer({ titre: 'Supprimer ?', message: '…', danger: true })) …
//   notifier('Pièce ajoutée');

import { create } from 'zustand';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bouton } from './composants';

interface DemandeConfirmation {
  titre: string;
  message?: string;
  libelleConfirmer?: string;
  libelleAnnuler?: string;
  danger?: boolean;
  resoudre: (ok: boolean) => void;
}

interface Notification {
  id: number;
  message: string;
  erreur?: boolean;
}

interface EtatDialogues {
  confirmation: DemandeConfirmation | null;
  notification: Notification | null;
}

const useDialogues = create<EtatDialogues>(() => ({ confirmation: null, notification: null }));

export function confirmer(options: Omit<DemandeConfirmation, 'resoudre'>): Promise<boolean> {
  return new Promise((resoudre) => {
    useDialogues.getState().confirmation?.resoudre(false);
    useDialogues.setState({ confirmation: { ...options, resoudre } });
  });
}

let compteur = 0;
export function notifier(message: string, options: { erreur?: boolean } = {}): void {
  useDialogues.setState({ notification: { id: ++compteur, message, erreur: options.erreur } });
}

export function HoteDialogues() {
  const { confirmation, notification } = useDialogues();

  useEffect(() => {
    if (!notification) return;
    const id = notification.id;
    const t = setTimeout(() => {
      if (useDialogues.getState().notification?.id === id) useDialogues.setState({ notification: null });
    }, 3200);
    return () => clearTimeout(t);
  }, [notification]);

  const repondre = (ok: boolean) => {
    confirmation?.resoudre(ok);
    useDialogues.setState({ confirmation: null });
  };

  return createPortal(
    <>
      {confirmation && (
        <>
          <div className="voile dialogue-voile" onClick={() => repondre(false)} />
          <div className="dialogue" role="alertdialog" aria-modal="true" aria-labelledby="dialogue-titre">
            <h2 id="dialogue-titre">{confirmation.titre}</h2>
            {confirmation.message && <p>{confirmation.message}</p>}
            <div className="dialogue-actions">
              <Bouton variante="contour" onClick={() => repondre(false)}>
                {confirmation.libelleAnnuler ?? 'Annuler'}
              </Bouton>
              <Bouton variante={confirmation.danger ? 'danger' : 'primaire'} onClick={() => repondre(true)} autoFocus>
                {confirmation.libelleConfirmer ?? 'Confirmer'}
              </Bouton>
            </div>
          </div>
        </>
      )}
      {notification && (
        <div className={`toast${notification.erreur ? ' erreur' : ''}`} role="status">
          {notification.message}
        </div>
      )}
    </>,
    document.body,
  );
}
