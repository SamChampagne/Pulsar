import { describe, it, expect } from 'vitest';
import {
  defaultDeskLayout,
  reconcileDeskLayout,
  DESK_LAYOUT_VERSION,
  FRAMEWORK_LINKS,
  defaultPosition,
  DESK_COLS,
  DESK_TILE,
  DESK_GAP,
  type DeskLayout,
} from './desk-layout';

const domains = [{ key: 'transport' }, { key: 'wms' }, { key: 'agents' }];

describe('FRAMEWORK_LINKS', () => {
  it('has no duplicate hrefs (duplicate keys crash the keyed folder render)', () => {
    const hrefs = FRAMEWORK_LINKS.map((l) => (l.type === 'link' ? l.href : ''));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('defaultDeskLayout', () => {
  it('creates one module item per domain plus a framework folder', () => {
    const layout = defaultDeskLayout(domains);
    expect(layout.version).toBe(DESK_LAYOUT_VERSION);
    const modules = layout.items.filter((i) => i.type === 'module');
    expect(modules.map((m) => (m as any).moduleKey)).toEqual(['transport', 'wms', 'agents']);
    const folder = layout.items.find((i) => i.type === 'folder' && (i as any).id === 'framework');
    expect(folder).toBeTruthy();
  });
});

describe('reconcileDeskLayout', () => {
  it('falls back to default when saved is invalid', () => {
    expect(reconcileDeskLayout(null, domains)).toEqual(defaultDeskLayout(domains));
    expect(reconcileDeskLayout({ junk: true }, domains)).toEqual(defaultDeskLayout(domains));
  });

  it('removes module items whose module is no longer visible', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [
        { type: 'module', moduleKey: 'transport' },
        { type: 'module', moduleKey: 'billing' },
      ],
    };
    const out = reconcileDeskLayout(saved, domains);
    const keys = out.items.filter((i) => i.type === 'module').map((i) => (i as any).moduleKey);
    expect(keys).toContain('transport');
    expect(keys).not.toContain('billing');
  });

  it('removes non-visible modules nested inside folders too', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [
        {
          type: 'folder',
          id: 'f1',
          name: 'Ops',
          items: [
            { type: 'module', moduleKey: 'transport' },
            { type: 'module', moduleKey: 'billing' },
          ],
        },
      ],
    };
    const out = reconcileDeskLayout(saved, domains);
    const folder = out.items.find((i) => i.type === 'folder') as any;
    const keys = folder.items.filter((i: any) => i.type === 'module').map((i: any) => i.moduleKey);
    expect(keys).toEqual(['transport']);
  });

  it('appends modules that are newly visible and not already placed (top-level or in a folder)', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [{ type: 'folder', id: 'f1', name: 'Ops', items: [{ type: 'module', moduleKey: 'transport' }] }],
    };
    const out = reconcileDeskLayout(saved, domains);
    const topKeys = out.items.filter((i) => i.type === 'module').map((i) => (i as any).moduleKey);
    expect(topKeys).not.toContain('transport');
    expect(topKeys).toContain('wms');
    expect(topKeys).toContain('agents');
  });

  it('keeps link items as-is and dedups folder ids', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [
        { type: 'link', href: '/loads', label: 'Loads' },
        { type: 'folder', id: 'dup', name: 'A', items: [] },
        { type: 'folder', id: 'dup', name: 'B', items: [] },
      ],
    };
    const out = reconcileDeskLayout(saved, domains);
    expect(out.items.some((i) => i.type === 'link' && (i as any).href === '/loads')).toBe(true);
    const folderIds = out.items.filter((i) => i.type === 'folder').map((i) => (i as any).id);
    expect(new Set(folderIds).size).toBe(folderIds.length);
  });
});

describe('positions', () => {
  it('defaultPosition lays out in a grid by index', () => {
    expect(defaultPosition(0)).toEqual({ x: DESK_GAP, y: DESK_GAP });
    expect(defaultPosition(1)).toEqual({ x: DESK_GAP + (DESK_TILE + DESK_GAP), y: DESK_GAP });
    expect(defaultPosition(DESK_COLS)).toEqual({ x: DESK_GAP, y: DESK_GAP + (DESK_TILE + DESK_GAP) });
  });

  it('defaultDeskLayout assigns a pos to every top-level item', () => {
    const layout = defaultDeskLayout([{ key: 'transport' }, { key: 'wms' }]);
    expect(layout.items.every((i) => i.pos && typeof i.pos.x === 'number')).toBe(true);
    expect(layout.items[0].pos).toEqual(defaultPosition(0));
  });

  it('reconcileDeskLayout preserves existing pos', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [{ type: 'module', moduleKey: 'transport', pos: { x: 500, y: 300 } }],
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }]);
    const t = out.items.find((i) => i.type === 'module' && (i as any).moduleKey === 'transport');
    expect(t?.pos).toEqual({ x: 500, y: 300 });
  });

  it('reconcileDeskLayout assigns a pos to items lacking one and to newly-visible modules', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [{ type: 'module', moduleKey: 'transport' }],
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }, { key: 'wms' }]);
    expect(out.items.every((i) => i.pos && typeof i.pos.x === 'number')).toBe(true);
    const wms = out.items.find((i) => i.type === 'module' && (i as any).moduleKey === 'wms');
    expect(wms?.pos).toBeTruthy();
  });

  it('reconcileDeskLayout is deterministic', () => {
    const saved: DeskLayout = { version: DESK_LAYOUT_VERSION, items: [{ type: 'module', moduleKey: 'transport' }] };
    expect(reconcileDeskLayout(saved, [{ key: 'transport' }])).toEqual(
      reconcileDeskLayout(saved, [{ key: 'transport' }]),
    );
  });
});
