import { writable } from 'svelte/store';

export interface Toast {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

export const toasts = writable<Toast[]>([]);

let nextId = 1;

function push(kind: Toast['kind'], message: string) {
  const id = nextId++;
  toasts.update((list) => [...list, { id, kind, message }]);
  setTimeout(() => toasts.update((list) => list.filter((t) => t.id !== id)), 4000);
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
};
