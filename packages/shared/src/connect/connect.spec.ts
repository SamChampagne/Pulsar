import { describe, expect, it } from 'vitest';
import {
  INBOUND_SOURCES,
  INBOUND_STATUSES,
  IMPORT_STATUSES,
  IMPORT_ROW_STATUSES,
  IMPORT_TARGETS,
  getImportTarget,
  applyMapping,
  validateRequired,
  coerceTypes,
  parseCsv,
} from './connect';

describe('IMPORT_TARGETS', () => {
  it('has exactly 6 entries', () => {
    expect(IMPORT_TARGETS).toHaveLength(6);
  });

  it('has customers with required columns [code, name]', () => {
    const t = getImportTarget('customers');
    expect(t).toBeDefined();
    expect(t!.requiredColumns).toEqual(['code', 'name']);
  });

  it('has carriers with scacCode in optional', () => {
    const t = getImportTarget('carriers');
    expect(t!.optionalColumns).toContain('scacCode');
  });

  it('returns undefined for unknown target', () => {
    expect(getImportTarget('unknown')).toBeUndefined();
  });

  it('all entries have a permission string', () => {
    IMPORT_TARGETS.forEach((t) => {
      expect(typeof t.permission).toBe('string');
      expect(t.permission.length).toBeGreaterThan(0);
    });
  });
});

describe('const arrays', () => {
  it('INBOUND_SOURCES contains CSV, PDF, DOCUMENT, WEBHOOK', () => {
    expect(INBOUND_SOURCES).toContain('CSV');
    expect(INBOUND_SOURCES).toContain('PDF');
    expect(INBOUND_SOURCES).toContain('DOCUMENT');
    expect(INBOUND_SOURCES).toContain('WEBHOOK');
  });

  it('INBOUND_STATUSES contains all 5 values', () => {
    expect(INBOUND_STATUSES).toHaveLength(5);
  });

  it('IMPORT_STATUSES contains PENDING, PROCESSING, COMPLETED, FAILED', () => {
    expect(IMPORT_STATUSES).toContain('PENDING');
    expect(IMPORT_STATUSES).toContain('PROCESSING');
    expect(IMPORT_STATUSES).toContain('COMPLETED');
    expect(IMPORT_STATUSES).toContain('FAILED');
  });

  it('IMPORT_ROW_STATUSES has IMPORTED and FAILED', () => {
    expect(IMPORT_ROW_STATUSES).toContain('IMPORTED');
    expect(IMPORT_ROW_STATUSES).toContain('FAILED');
  });
});

describe('applyMapping', () => {
  it('renames columns to DTO fields and trims values', () => {
    const row = { 'Customer Code': '  ACME  ', 'Customer Name': 'Acme Corp' };
    const mapping = { code: 'Customer Code', name: 'Customer Name' };
    expect(applyMapping(row, mapping)).toEqual({ code: 'ACME', name: 'Acme Corp' });
  });

  it('skips mapping entries whose column is not in the row', () => {
    const row = { code: 'A' };
    const mapping = { code: 'code', name: 'Name' };
    expect(applyMapping(row, mapping)).toEqual({ code: 'A' });
  });

  it('returns empty object for empty row', () => {
    expect(applyMapping({}, { code: 'code' })).toEqual({});
  });
});

describe('validateRequired', () => {
  it('returns empty array when all required fields present', () => {
    expect(validateRequired({ code: 'A', name: 'B' }, ['code', 'name'])).toEqual([]);
  });

  it('returns missing field names', () => {
    expect(validateRequired({ code: 'A' }, ['code', 'name'])).toEqual(['name']);
  });

  it('treats empty string as missing', () => {
    expect(validateRequired({ code: '', name: 'B' }, ['code', 'name'])).toEqual(['code']);
  });

  it('treats undefined as missing', () => {
    expect(validateRequired({ name: 'B' }, ['code', 'name'])).toEqual(['code']);
  });
});

describe('coerceTypes', () => {
  const target = getImportTarget('locations')!;

  it('coerces latitude and longitude to numbers', () => {
    const result = coerceTypes({ latitude: '45.5', longitude: '-73.6', code: 'LOC1', name: 'Depot' }, target);
    expect(result.latitude).toBe(45.5);
    expect(result.longitude).toBe(-73.6);
  });

  it('leaves non-numeric strings for numeric fields as-is (not parseable)', () => {
    const result = coerceTypes({ latitude: 'abc', code: 'LOC1', name: 'Depot' }, target);
    expect(result.latitude).toBe('abc');
  });

  it('drops empty strings', () => {
    const result = coerceTypes({ code: 'A', name: '', latitude: '' }, target);
    expect('name' in result).toBe(false);
    expect('latitude' in result).toBe(false);
  });

  it('coerces year for vehicles', () => {
    const vehicleTarget = getImportTarget('vehicles')!;
    const result = coerceTypes({ unitNumber: 'V1', type: 'TRUCK', year: '2020' }, vehicleTarget);
    expect(result.year).toBe(2020);
  });

  it('coerces capacityWeightKg for trailers', () => {
    const trailerTarget = getImportTarget('trailers')!;
    const result = coerceTypes({ unitNumber: 'T1', type: 'DRY_VAN', capacityWeightKg: '20000.5' }, trailerTarget);
    expect(result.capacityWeightKg).toBe(20000.5);
  });
});

describe('parseCsv', () => {
  it('parses simple CSV with headers', () => {
    const text = 'code,name\nA001,Acme Corp\nB002,Beta Inc';
    const result = parseCsv(text);
    expect(result.headers).toEqual(['code', 'name']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ code: 'A001', name: 'Acme Corp' });
    expect(result.rows[1]).toEqual({ code: 'B002', name: 'Beta Inc' });
  });

  it('handles CRLF line endings', () => {
    const text = 'code,name\r\nA001,Acme Corp\r\nB002,Beta Inc';
    const result = parseCsv(text);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].code).toBe('A001');
  });

  it('handles quoted fields with commas inside', () => {
    const text = 'code,name\nA001,"Acme, Corp"';
    const result = parseCsv(text);
    expect(result.rows[0].name).toBe('Acme, Corp');
  });

  it('handles double-quote escaping inside quoted fields', () => {
    const text = 'code,name\nA001,"It\'s ""Great"""';
    const result = parseCsv(text);
    expect(result.rows[0].name).toBe('It\'s "Great"');
  });

  it('ignores trailing newline', () => {
    const text = 'code,name\nA001,Acme\n';
    const result = parseCsv(text);
    expect(result.rows).toHaveLength(1);
  });

  it('returns empty rows array for header-only CSV', () => {
    const text = 'code,name';
    const result = parseCsv(text);
    expect(result.headers).toEqual(['code', 'name']);
    expect(result.rows).toHaveLength(0);
  });

  it('maps row values to headers', () => {
    const text = 'a,b,c\n1,2,3';
    const result = parseCsv(text);
    expect(result.rows[0]).toEqual({ a: '1', b: '2', c: '3' });
  });
});
