import { writable } from 'svelte/store';

export type Theme = 'warm' | 'cool' | 'dark';

export const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'warm', label: 'Chaud', hint: 'Orange & crème (défaut)' },
  { id: 'cool', label: 'Ardoise', hint: 'Bleu & gris froid' },
  { id: 'dark', label: 'Nuit', hint: 'Sombre chaud' },
];

const STORAGE_KEY = 'pulsar.theme';

function readInitial(): Theme {
  if (typeof localStorage === 'undefined') return 'warm';
  const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
  return saved === 'warm' || saved === 'cool' || saved === 'dark' ? saved : 'warm';
}

export const theme = writable<Theme>(readInitial());

/** Apply a theme to <html data-theme> and persist it. */
export function setTheme(t: Theme) {
  theme.set(t);
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, t);
}

/** Call once at app start to apply the stored theme (avoids a flash of the default). */
export function initTheme() {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = readInitial();
}
