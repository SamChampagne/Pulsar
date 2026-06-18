export type AppearanceTheme = 'warm' | 'cool' | 'dark';
export const APPEARANCE_THEMES: AppearanceTheme[] = ['warm', 'cool', 'dark'];

export interface Appearance {
  theme?: AppearanceTheme;
  accent?: string; // hex
}

export interface AccentVars {
  accent: string;
  hover: string;
  soft: string;
}

export function isHexColor(s: string): boolean {
  return typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

function normalize(hex: string): string {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  return '#' + full.toLowerCase();
}

function toRgb(hex: string): [number, number, number] {
  const n = normalize(hex).slice(1);
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Accent override: hover ≈ 12% darker, soft ≈ 88% white tint. */
export function deriveAccent(hex: string): AccentVars {
  const [r, g, b] = toRgb(hex);
  const hover = toHex(r * 0.88, g * 0.88, b * 0.88);
  const mix = 0.88; // share of white
  const soft = toHex(
    r * (1 - mix) + 255 * mix,
    g * (1 - mix) + 255 * mix,
    b * (1 - mix) + 255 * mix,
  );
  return { accent: normalize(hex), hover, soft };
}
