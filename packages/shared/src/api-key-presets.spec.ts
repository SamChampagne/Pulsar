import { describe, expect, it } from 'vitest';
import { ALL_PERMISSION_KEYS, PERMISSIONS } from './permissions';
import { API_KEY_SCOPE_PRESETS } from './api-key-presets';

describe('API_KEY_SCOPE_PRESETS', () => {
  it('has exactly read-only, orders-intake and tracking', () => {
    expect(API_KEY_SCOPE_PRESETS.map((p) => p.key)).toEqual([
      'read-only',
      'orders-intake',
      'tracking',
    ]);
  });

  it('read-only contains every *.read permission key and nothing else', () => {
    const preset = API_KEY_SCOPE_PRESETS.find((p) => p.key === 'read-only')!;
    const expected = ALL_PERMISSION_KEYS.filter((k) => k.endsWith('.read'));
    expect(new Set(preset.scopes)).toEqual(new Set(expected));
    expect(preset.scopes.length).toBeGreaterThan(10);
    for (const scope of preset.scopes) expect(scope.endsWith('.read')).toBe(true);
  });

  it('orders-intake grants order creation + master-data/locations read', () => {
    const preset = API_KEY_SCOPE_PRESETS.find((p) => p.key === 'orders-intake')!;
    expect(new Set(preset.scopes)).toEqual(
      new Set([
        PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE,
        PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ,
        PERMISSIONS.CORE.LOCATIONS_READ,
      ]),
    );
  });

  it('tracking grants only transportation.tracking.read', () => {
    const preset = API_KEY_SCOPE_PRESETS.find((p) => p.key === 'tracking')!;
    expect(preset.scopes).toEqual([PERMISSIONS.TRANSPORTATION.TRACKING_READ]);
  });

  it('every scope of every preset is a real permission key', () => {
    const valid = new Set(ALL_PERMISSION_KEYS);
    for (const preset of API_KEY_SCOPE_PRESETS) {
      for (const scope of preset.scopes) expect(valid.has(scope)).toBe(true);
    }
  });
});
