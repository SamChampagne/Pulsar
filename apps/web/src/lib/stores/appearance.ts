import { writable } from 'svelte/store';
import {
  deriveAccent,
  isHexColor,
  type Appearance,
  type AppearanceTheme,
} from '@pulsar/shared';
import { putPreferences } from '$lib/api/preferences';

const THEME_KEY = 'pulsar.theme';
const ACCENT_KEY = 'pulsar.accent';

function readInitial(): Appearance {
  if (typeof localStorage === 'undefined') return { theme: 'warm' };
  const t = localStorage.getItem(THEME_KEY);
  const accent = localStorage.getItem(ACCENT_KEY) ?? undefined;
  const theme: AppearanceTheme = t === 'cool' || t === 'dark' ? t : 'warm';
  return { theme, ...(accent && isHexColor(accent) ? { accent } : {}) };
}

export const appearance = writable<Appearance>(readInitial());

/** Apply theme + accent vars to <html>. */
export function applyAppearance(a: Appearance) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = a.theme ?? 'warm';
  if (a.accent && isHexColor(a.accent)) {
    const v = deriveAccent(a.accent);
    root.style.setProperty('--t-accent', v.accent);
    root.style.setProperty('--t-accent-hover', v.hover);
    root.style.setProperty('--t-accent-soft', v.soft);
  } else {
    root.style.removeProperty('--t-accent');
    root.style.removeProperty('--t-accent-hover');
    root.style.removeProperty('--t-accent-soft');
  }
}

function cache(a: Appearance) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(THEME_KEY, a.theme ?? 'warm');
  if (a.accent && isHexColor(a.accent)) localStorage.setItem(ACCENT_KEY, a.accent);
  else localStorage.removeItem(ACCENT_KEY);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(a: Appearance) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void putPreferences({ appearance: a }).catch(() => {});
  }, 400);
}

export function setTheme(theme: AppearanceTheme) {
  appearance.update((a) => {
    const next = { ...a, theme };
    applyAppearance(next);
    cache(next);
    persist(next);
    return next;
  });
}

export function setAccent(accent: string | null) {
  appearance.update((a) => {
    const next: Appearance = { ...a };
    if (accent && isHexColor(accent)) next.accent = accent;
    else delete next.accent;
    applyAppearance(next);
    cache(next);
    persist(next);
    return next;
  });
}

/** Reconcile from the DB after auth/prefs load (source of truth), refresh cache + DOM. */
export function loadAppearanceFrom(raw: unknown) {
  const r = (raw ?? {}) as Partial<Appearance>;
  const theme: AppearanceTheme =
    r.theme === 'cool' || r.theme === 'dark' || r.theme === 'warm' ? r.theme : 'warm';
  const next: Appearance = {
    theme,
    ...(r.accent && isHexColor(r.accent) ? { accent: r.accent } : {}),
  };
  appearance.set(next);
  applyAppearance(next);
  cache(next);
}
