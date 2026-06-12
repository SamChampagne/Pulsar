import { writable } from 'svelte/store';

const KEY = 'pulsar:table-density';
type Density = 'comfortable' | 'compact';

function initial(): Density {
  if (typeof localStorage === 'undefined') return 'comfortable';
  return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable';
}

export const density = writable<Density>(initial());
density.subscribe((v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v);
});

export function toggleDensity() {
  density.update((v) => (v === 'compact' ? 'comfortable' : 'compact'));
}
