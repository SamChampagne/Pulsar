import { browserTimeZone, isTimeZone } from '@pulsar/shared';
import { SvelteMap } from 'svelte/reactivity';

/** Reactive getters also invalidate callers of formatDateTime inside Svelte templates. */
const state = new SvelteMap<string, string>();
export const userTimeZone = {
  get value() {
    return state.get('saved') ?? browserTimeZone();
  },
  get preference() {
    return state.get('saved') ?? null;
  },
  load(value: unknown) {
    if (isTimeZone(value)) state.set('saved', value);
    else state.delete('saved');
  },
};
