export const DESK_LAYOUT_VERSION = 1;

export type DeskFolderChild =
  | { type: 'module'; moduleKey: string }
  | { type: 'link'; href: string; label: string; icon?: string };

export type DeskItem =
  | { type: 'module'; moduleKey: string }
  | { type: 'link'; href: string; label: string; icon?: string }
  | { type: 'folder'; id: string; name: string; items: DeskFolderChild[] };

export interface DeskLayout {
  version: number;
  items: DeskItem[];
}

export const FRAMEWORK_FOLDER_ID = 'framework';

export const FRAMEWORK_LINKS: DeskFolderChild[] = [
  { type: 'link', href: '/settings/appearance', label: 'Réglages' },
  { type: 'link', href: '/settings/modules', label: 'Modules' },
  { type: 'link', href: '/settings/users', label: 'Utilisateurs' },
  { type: 'link', href: '/settings/agent-runtime', label: 'Automation' },
];

export function defaultDeskLayout(domains: { key: string }[]): DeskLayout {
  const moduleItems: DeskItem[] = domains
    .filter((d) => d.key !== 'dashboard')
    .map((d) => ({ type: 'module', moduleKey: d.key }));
  return {
    version: DESK_LAYOUT_VERSION,
    items: [
      ...moduleItems,
      { type: 'folder', id: FRAMEWORK_FOLDER_ID, name: 'Framework', items: [...FRAMEWORK_LINKS] },
    ],
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
  const s = saved as DeskLayout | null | undefined;
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
      items.push({ type: 'folder', id, name: raw.name, items: cleanChildren(raw.items) });
    }
  }

  for (const d of domains) {
    if (d.key === 'dashboard') continue;
    if (!placed.has(d.key)) {
      items.push({ type: 'module', moduleKey: d.key });
      placed.add(d.key);
    }
  }

  return { version: DESK_LAYOUT_VERSION, items };
}
