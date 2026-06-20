export const DESK_LAYOUT_VERSION = 1;

export type DeskMode = 'auto' | 'free' | 'reorder';
export const DESK_MODES: DeskMode[] = ['auto', 'free', 'reorder'];

export interface DeskPosition {
  x: number;
  y: number;
}

export const DESK_TILE = 96;
export const DESK_GAP = 28;
export const DESK_COLS = 6;
export const DESK_CANVAS_W = DESK_COLS * (DESK_TILE + DESK_GAP) + DESK_GAP;

export type DeskTileSize = 'sm' | 'md' | 'lg';
export const TILE_SIZES: Record<DeskTileSize, number> = { sm: 76, md: 96, lg: 120 };

export type DeskBackground =
  | { type: 'color'; value: string }
  | { type: 'gradient'; value: string } // value = DeskGradient.id
  | { type: 'image'; value: string }; // value = Document id

export interface DeskGradient {
  id: string;
  label: string;
  css: string;
}

export const DESK_GRADIENTS: DeskGradient[] = [
  { id: 'aurora', label: 'Aurore', css: 'linear-gradient(135deg,#1e3a8a 0%,#7e22ce 100%)' },
  { id: 'sunset', label: 'Coucher', css: 'linear-gradient(135deg,#f1700f 0%,#be123c 100%)' },
  { id: 'mint', label: 'Menthe', css: 'linear-gradient(135deg,#0f766e 0%,#22c55e 100%)' },
  { id: 'slate', label: 'Ardoise', css: 'linear-gradient(135deg,#0f172a 0%,#334155 100%)' },
  { id: 'sand', label: 'Sable', css: 'linear-gradient(135deg,#fdf2e9 0%,#e7d3b3 100%)' },
];

export function defaultPosition(index: number): DeskPosition {
  const col = index % DESK_COLS;
  const row = Math.floor(index / DESK_COLS);
  return {
    x: DESK_GAP + col * (DESK_TILE + DESK_GAP),
    y: DESK_GAP + row * (DESK_TILE + DESK_GAP),
  };
}

export type DeskFolderChild =
  | { type: 'module'; moduleKey: string }
  | { type: 'link'; href: string; label: string; icon?: string };

export type DeskItem =
  | { type: 'module'; moduleKey: string; pos?: DeskPosition }
  | { type: 'link'; href: string; label: string; icon?: string; pos?: DeskPosition }
  | { type: 'folder'; id: string; name: string; items: DeskFolderChild[]; pos?: DeskPosition };

export interface DeskLayout {
  version: number;
  mode: DeskMode;
  items: DeskItem[];
  tileSize?: DeskTileSize;
  background?: DeskBackground;
}

export const FRAMEWORK_FOLDER_ID = 'framework';

/**
 * The platform dashboard (`/dashboard`) has no business module, so the `dashboard`
 * domain is excluded from the module tiles. We surface it explicitly as a first-class
 * link tile so users still get a desk shortcut to the "Tableau de bord".
 */
export const DASHBOARD_HREF = '/dashboard';
export const DASHBOARD_LINK: Extract<DeskItem, { type: 'link' }> = {
  type: 'link',
  href: DASHBOARD_HREF,
  label: 'Tableau de bord',
};

export const FRAMEWORK_LINKS: DeskFolderChild[] = [
  { type: 'link', href: '/settings/appearance', label: 'Réglages' },
  { type: 'link', href: '/settings/modules', label: 'Modules' },
  { type: 'link', href: '/settings/users', label: 'Utilisateurs' },
  { type: 'link', href: '/settings/agent-runtime', label: 'Automation' },
];

export function defaultDeskLayout(domains: { key: string }[]): DeskLayout {
  const base: DeskItem[] = [
    { ...DASHBOARD_LINK },
    ...domains
      .filter((d) => d.key !== 'dashboard')
      .map((d): DeskItem => ({ type: 'module', moduleKey: d.key })),
    { type: 'folder', id: FRAMEWORK_FOLDER_ID, name: 'Framework', items: [...FRAMEWORK_LINKS] },
  ];
  return {
    version: DESK_LAYOUT_VERSION,
    mode: 'auto',
    items: base.map((it, i) => ({ ...it, pos: defaultPosition(i) })),
  };
}

function isChild(x: unknown): x is DeskFolderChild {
  if (!x || typeof x !== 'object') return false;
  const t = (x as Record<string, unknown>).type;
  if (t === 'module') return typeof (x as Record<string, unknown>).moduleKey === 'string';
  if (t === 'link')
    return (
      typeof (x as Record<string, unknown>).href === 'string' &&
      typeof (x as Record<string, unknown>).label === 'string'
    );
  return false;
}

function isItem(x: unknown): x is DeskItem {
  if (isChild(x)) return true;
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.type !== 'folder') return false;
  return typeof o.id === 'string' && typeof o.name === 'string' && Array.isArray(o.items);
}

export function reconcileDeskLayout(saved: unknown, domains: { key: string }[]): DeskLayout {
  const visible = new Set(domains.filter((d) => d.key !== 'dashboard').map((d) => d.key));
  const s = saved as (DeskLayout & { tileSize?: unknown; background?: unknown }) | null | undefined;
  if (!s || typeof s !== 'object' || !Array.isArray(s.items)) {
    return defaultDeskLayout(domains);
  }

  const placed = new Set<string>();
  const seenFolderIds = new Set<string>();

  const cleanChildren = (children: unknown[]): DeskFolderChild[] =>
    children.filter(isChild).filter((c) => {
      if (c.type === 'module') {
        if (!visible.has(c.moduleKey)) return false;
        placed.add(c.moduleKey);
      }
      return true;
    });

  const items: DeskItem[] = [];
  for (const raw of s.items) {
    if (!isItem(raw)) continue;
    if (raw.type === 'module') {
      if (!visible.has(raw.moduleKey)) continue;
      placed.add(raw.moduleKey);
      items.push(raw);
    } else if (raw.type === 'link') {
      items.push(raw);
    } else {
      let id = raw.id;
      let bump = 1;
      while (seenFolderIds.has(id)) {
        id = `${raw.id}-${bump}`;
        bump += 1;
      }
      seenFolderIds.add(id);
      const folderItem: DeskItem = {
        type: 'folder',
        id,
        name: raw.name,
        items: cleanChildren(raw.items),
        ...(raw.pos ? { pos: raw.pos } : {}),
      };
      items.push(folderItem);
    }
  }

  for (const d of domains) {
    if (d.key === 'dashboard') continue;
    if (!placed.has(d.key)) {
      items.push({ type: 'module', moduleKey: d.key });
      placed.add(d.key);
    }
  }

  const positioned = items.map((it, i) => (it.pos ? it : { ...it, pos: defaultPosition(i) }));
  const savedMode = (s && typeof s === 'object') ? (s as { mode?: unknown }).mode : undefined;
  const mode: DeskMode = DESK_MODES.includes(savedMode as DeskMode) ? (savedMode as DeskMode) : 'auto';

  // Re-inject the Dashboard tile and the Framework folder if the saved layout lost
  // them (symmetric to re-adding newly-visible modules). Appended at the end so we
  // never overlap a user-positioned tile in 'free' mode.
  let finalItems: DeskItem[] = positioned;

  const hasDashboard = finalItems.some(
    (it) => it.type === 'link' && it.href === DASHBOARD_HREF,
  );
  if (!hasDashboard) {
    finalItems = [
      ...finalItems,
      { ...DASHBOARD_LINK, pos: defaultPosition(finalItems.length) },
    ];
  }

  const hasFramework = finalItems.some(
    (it) => it.type === 'folder' && it.id === FRAMEWORK_FOLDER_ID,
  );
  if (!hasFramework) {
    finalItems = [
      ...finalItems,
      {
        type: 'folder' as const,
        id: FRAMEWORK_FOLDER_ID,
        name: 'Framework',
        items: [...FRAMEWORK_LINKS],
        pos: defaultPosition(finalItems.length),
      },
    ];
  }

  const tileSize: DeskTileSize | undefined =
    s.tileSize === 'sm' || s.tileSize === 'md' || s.tileSize === 'lg' ? s.tileSize : undefined;
  const bg = isDeskBackground(s.background) ? s.background : undefined;

  return {
    version: DESK_LAYOUT_VERSION,
    mode,
    items: finalItems,
    ...(tileSize ? { tileSize } : {}),
    ...(bg ? { background: bg } : {}),
  };
}

function isDeskBackground(x: unknown): x is DeskBackground {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    (o.type === 'color' || o.type === 'gradient' || o.type === 'image') &&
    typeof o.value === 'string'
  );
}
