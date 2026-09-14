import { writable } from 'svelte/store';

export interface Confirmation {
  id: number;
  message: string;
  title: string;
  confirmLabel: string;
  dangerous: boolean;
}

const current = writable<Confirmation | null>(null);
export const confirmation = { subscribe: current.subscribe };
let sequence = 0;
let pending: { id: number; resolve: (accepted: boolean) => void } | null = null;

/** One deliberate decision at a time. A superseded request fails closed. */
export function confirmAction(
  message: string,
  options: Partial<Omit<Confirmation, 'id' | 'message'>> = {},
): Promise<boolean> {
  cancelConfirmation();
  const id = ++sequence;
  return new Promise((resolve) => {
    pending = { id, resolve };
    current.set({
      id,
      message,
      title: 'Confirmer cette action',
      confirmLabel: 'Confirmer',
      dangerous: true,
      ...options,
    });
  });
}

export function answerConfirmation(id: number, accepted: boolean) {
  if (!pending || pending.id !== id) return;
  const resolve = pending.resolve;
  pending = null;
  current.set(null);
  resolve(accepted);
}

export function cancelConfirmation() {
  if (pending) answerConfirmation(pending.id, false);
}
