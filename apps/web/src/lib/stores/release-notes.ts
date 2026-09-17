import { writable } from 'svelte/store';

/** Unseen "what's new" count shown as a badge on the Sparkles button (app layout). */
export const unseenReleaseNotes = writable(0);
