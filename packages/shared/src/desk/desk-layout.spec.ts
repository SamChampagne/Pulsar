import { describe, it, expect } from 'vitest';
import {
  defaultDeskLayout,
  reconcileDeskLayout,
  DESK_LAYOUT_VERSION,
  DESK_MODES,
  FRAMEWORK_LINKS,
  FRAMEWORK_FOLDER_ID,
  defaultPosition,
  DESK_COLS,
  DESK_TILE,
  DESK_GAP,
  TILE_SIZES,
  DESK_GRADIENTS,
  type DeskLayout,
  type DeskMode,
  type DeskTileSize,
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
      mode: 'auto',
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
      mode: 'auto',
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
      mode: 'auto',
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
      mode: 'auto',
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
      mode: 'auto',
      items: [{ type: 'module', moduleKey: 'transport', pos: { x: 500, y: 300 } }],
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }]);
    const t = out.items.find((i) => i.type === 'module' && (i as any).moduleKey === 'transport');
    expect(t?.pos).toEqual({ x: 500, y: 300 });
  });

  it('reconcileDeskLayout assigns a pos to items lacking one and to newly-visible modules', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      mode: 'auto',
      items: [{ type: 'module', moduleKey: 'transport' }],
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }, { key: 'wms' }]);
    expect(out.items.every((i) => i.pos && typeof i.pos.x === 'number')).toBe(true);
    const wms = out.items.find((i) => i.type === 'module' && (i as any).moduleKey === 'wms');
    expect(wms?.pos).toBeTruthy();
  });

  it('reconcileDeskLayout is deterministic', () => {
    const saved: DeskLayout = { version: DESK_LAYOUT_VERSION, mode: 'auto', items: [{ type: 'module', moduleKey: 'transport' }] };
    expect(reconcileDeskLayout(saved, [{ key: 'transport' }])).toEqual(
      reconcileDeskLayout(saved, [{ key: 'transport' }]),
    );
  });
});

describe('mode', () => {
  it('defaultDeskLayout defaults to auto', () => {
    expect(defaultDeskLayout([{ key: 'transport' }]).mode).toBe('auto');
  });
  it('reconcileDeskLayout preserves a valid saved mode', () => {
    const saved: DeskLayout = { version: DESK_LAYOUT_VERSION, mode: 'free', items: [] };
    expect(reconcileDeskLayout(saved, [{ key: 'transport' }]).mode).toBe('free');
  });
  it('reconcileDeskLayout falls back to auto for missing/invalid mode', () => {
    const noMode = { version: DESK_LAYOUT_VERSION, items: [] } as unknown;
    expect(reconcileDeskLayout(noMode, [{ key: 'transport' }]).mode).toBe('auto');
    const bad = { version: DESK_LAYOUT_VERSION, mode: 'nope', items: [] } as unknown;
    expect(reconcileDeskLayout(bad, [{ key: 'transport' }]).mode).toBe('auto');
  });
  it('DESK_MODES lists the three modes', () => {
    expect(DESK_MODES).toEqual(['auto', 'free', 'reorder']);
  });
});

describe('tile sizes & background', () => {
  it('TILE_SIZES maps sm/md/lg to 76/96/120', () => {
    expect(TILE_SIZES).toEqual({ sm: 76, md: 96, lg: 120 });
  });

  it('DESK_GRADIENTS entries have unique ids and a css string', () => {
    expect(DESK_GRADIENTS.length).toBeGreaterThan(0);
    const ids = DESK_GRADIENTS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DESK_GRADIENTS.every((g) => typeof g.css === 'string' && g.css.length > 0)).toBe(true);
  });

  it('reconcileDeskLayout preserves tileSize and background', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      mode: 'free',
      items: [{ type: 'module', moduleKey: 'transport' }],
      tileSize: 'lg' as DeskTileSize,
      background: { type: 'color', value: '#101010' },
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }]);
    expect(out.tileSize).toBe('lg');
    expect(out.background).toEqual({ type: 'color', value: '#101010' });
  });

  it('reconcileDeskLayout re-injects the Framework folder when missing', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      mode: 'auto',
      items: [{ type: 'module', moduleKey: 'transport' }],
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }]);
    const fw = out.items.find((i) => i.type === 'folder' && (i as any).id === FRAMEWORK_FOLDER_ID);
    expect(fw).toBeTruthy();
  });

  it('reconcileDeskLayout does not duplicate an existing Framework folder', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      mode: 'auto',
      items: [{ type: 'folder', id: FRAMEWORK_FOLDER_ID, name: 'Framework', items: [] }],
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }]);
    const fws = out.items.filter((i) => i.type === 'folder' && (i as any).id === FRAMEWORK_FOLDER_ID);
    expect(fws.length).toBe(1);
  });
});
