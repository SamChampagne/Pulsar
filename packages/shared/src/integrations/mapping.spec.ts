import { afterEach, describe, it, expect } from 'vitest';
import {
  applyIntegrationMapping,
  applyIntegrationTransform,
  getMappingPath,
  isKnownTransform,
  isUnsafeMappingPath,
  normalizeMappingRules,
  setMappingPath,
  validateMappingPaths,
} from './mapping';

describe('applyIntegrationTransform', () => {
  it('applies the four legacy transforms', () => {
    expect(applyIntegrationTransform('  a  ', 'trim')).toBe('a');
    expect(applyIntegrationTransform('ab', 'uppercase')).toBe('AB');
    expect(applyIntegrationTransform('12.5', 'number')).toBe(12.5);
    expect(applyIntegrationTransform('2026-01-02T03:04:05Z', 'date.iso')).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });

  it('default:<value> fills an empty input and leaves a real value alone', () => {
    expect(applyIntegrationTransform(undefined, 'default:FTL')).toBe('FTL');
    expect(applyIntegrationTransform('', 'default:FTL')).toBe('FTL');
    expect(applyIntegrationTransform(null, 'default:FTL')).toBe('FTL');
    expect(applyIntegrationTransform('LTL', 'default:FTL')).toBe('LTL');
  });

  it('concat:<sep> joins an array and stringifies a scalar', () => {
    expect(applyIntegrationTransform(['a', 'b', 'c'], 'concat: ')).toBe('a b c');
    expect(applyIntegrationTransform(['a', '', 'c'], 'concat:-')).toBe('a-c');
    expect(applyIntegrationTransform(42, 'concat:,')).toBe('42');
  });

  it('is a no-op for an unknown transform (lenient) and throws in strict mode', () => {
    expect(applyIntegrationTransform('x', 'x12.segment')).toBe('x');
    expect(() => applyIntegrationTransform('x', 'x12.segment', true)).toThrow(/Unknown transform/);
  });

  it('never invents a value out of null except with default:', () => {
    expect(applyIntegrationTransform(null, 'number')).toBeNull();
    expect(applyIntegrationTransform(undefined, 'uppercase')).toBeUndefined();
  });
});

describe('isKnownTransform', () => {
  it('accepts the plain keys, the prefix forms and the empty transform', () => {
    for (const t of [
      '',
      'none',
      'trim',
      'uppercase',
      'number',
      'date.iso',
      'default:x',
      'concat:|',
    ])
      expect(isKnownTransform(t)).toBe(true);
    expect(isKnownTransform(undefined)).toBe(true);
    expect(isKnownTransform('enum.map')).toBe(false);
  });
});

describe('normalizeMappingRules', () => {
  it('reads the studio shape and the from/to aliases', () => {
    expect(
      normalizeMappingRules([
        { source: 'a', target: 'b', transform: 'trim', required: true },
        { from: 'c', to: 'd' },
        { source: '', target: '' },
        'nope',
        null,
      ]),
    ).toEqual([
      { source: 'a', target: 'b', transform: 'trim', required: true },
      { source: 'c', target: 'd', transform: 'none', required: false },
    ]);
  });

  it('returns [] for a non-array', () => {
    expect(normalizeMappingRules(undefined)).toEqual([]);
    expect(normalizeMappingRules({ a: 1 })).toEqual([]);
  });
});

describe('applyIntegrationMapping', () => {
  const payload = {
    order: { reference: ' ref-9 ', customer: { code: 'acme' }, parts: ['x', 'y'] },
    stops: { from: 'MTL', to: 'TOR' },
  };

  it('reads dotted sources and writes dotted targets', () => {
    const result = applyIntegrationMapping(payload, [
      { source: 'order.customer.code', target: 'customerCode', transform: 'uppercase' },
      { source: 'stops.from', target: 'nested.originCode' },
      { source: 'order.reference', target: 'customerReference', transform: 'trim' },
    ]);
    expect(result.output).toEqual({
      customerCode: 'ACME',
      nested: { originCode: 'MTL' },
      customerReference: 'ref-9',
    });
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.status)).toEqual(['mapped', 'mapped', 'mapped']);
  });

  it('marks a missing source as missing and reports it only when required', () => {
    const result = applyIntegrationMapping(payload, [
      { source: 'order.nope', target: 'a' },
      { source: 'order.alsoNope', target: 'b', required: true },
    ]);
    expect(result.output).toEqual({});
    expect(result.rows.map((r) => r.status)).toEqual(['missing', 'missing']);
    expect(result.errors).toEqual(['Champ requis manquant: order.alsoNope']);
  });

  it('skips a row without source or target', () => {
    const result = applyIntegrationMapping(payload, [{ source: 'stops.from', target: '' }]);
    expect(result.rows[0].status).toBe('skipped');
    expect(result.output).toEqual({});
  });

  it('never coerces an empty source (number on "" stays missing, not 0)', () => {
    const result = applyIntegrationMapping({ a: '' }, [
      { source: 'a', target: 'weight', transform: 'number' },
    ]);
    expect(result.rows[0].status).toBe('missing');
    expect(result.output).toEqual({});
  });

  it('default: turns a missing source into a mapped value', () => {
    const result = applyIntegrationMapping(payload, [
      { source: 'order.mode', target: 'mode', transform: 'default:FTL' },
    ]);
    expect(result.rows[0].status).toBe('mapped');
    expect(result.output).toEqual({ mode: 'FTL' });
  });

  it('concat: joins an array source', () => {
    const result = applyIntegrationMapping(payload, [
      { source: 'order.parts', target: 'notes', transform: 'concat:, ' },
    ]);
    expect(result.output).toEqual({ notes: 'x, y' });
  });

  it('reports unknown transforms in strict mode only', () => {
    const rules = [{ source: 'stops.from', target: 'originCode', transform: 'enum.map' }];
    expect(applyIntegrationMapping(payload, rules).errors).toEqual([]);
    expect(applyIntegrationMapping(payload, rules, { strictTransforms: true }).errors).toEqual([
      'Unknown transform: "enum.map"',
    ]);
  });

  it('is pure — the payload is never mutated', () => {
    const input = { a: { b: 'c' } };
    applyIntegrationMapping(input, [{ source: 'a.b', target: 'a.b', transform: 'uppercase' }]);
    expect(input).toEqual({ a: { b: 'c' } });
  });
});

describe('prototype pollution guard', () => {
  afterEach(() => {
    // Whatever a test attempted, the prototype must stay clean.
    delete (Object.prototype as Record<string, unknown>).polluted;
    delete (Object.prototype as Record<string, unknown>).b;
  });

  it('isUnsafeMappingPath flags the three walking segments, anywhere in the path', () => {
    expect(isUnsafeMappingPath('__proto__.polluted')).toBe(true);
    expect(isUnsafeMappingPath('constructor.prototype.polluted')).toBe(true);
    expect(isUnsafeMappingPath('a.__proto__.b')).toBe(true);
    expect(isUnsafeMappingPath('a.prototype')).toBe(true);
    expect(isUnsafeMappingPath('a.b.c')).toBe(false);
    expect(isUnsafeMappingPath('proto.constructorName')).toBe(false);
  });

  it('applyIntegrationMapping refuses __proto__.x and never touches Object.prototype', () => {
    const result = applyIntegrationMapping({ a: 'boom' }, [
      { source: 'a', target: '__proto__.polluted' },
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.output).toEqual({});
    expect(result.rows[0].status).toBe('skipped');
    expect(result.errors).toEqual(['Unsafe mapping target: "__proto__.polluted"']);
  });

  it('refuses constructor.prototype.x', () => {
    const result = applyIntegrationMapping({ a: 'boom' }, [
      { source: 'a', target: 'constructor.prototype.polluted' },
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.output).toEqual({});
    expect(result.errors).toEqual(['Unsafe mapping target: "constructor.prototype.polluted"']);
  });

  it('refuses a nested a.__proto__.b', () => {
    const result = applyIntegrationMapping({ a: 'boom' }, [
      { source: 'a', target: 'a.__proto__.b' },
    ]);
    expect(({} as Record<string, unknown>).b).toBeUndefined();
    expect(result.output).toEqual({});
    expect(result.errors).toEqual(['Unsafe mapping target: "a.__proto__.b"']);
  });

  it('refuses an unsafe SOURCE too (no prototype leak into the output)', () => {
    const result = applyIntegrationMapping({ a: 'x' }, [{ source: 'a.__proto__', target: 'leak' }]);
    expect(result.output).toEqual({});
    expect(result.errors).toEqual(['Unsafe mapping source: "a.__proto__"']);
  });

  it('setMappingPath throws rather than writing an unsafe path', () => {
    const target: Record<string, unknown> = {};
    expect(() => setMappingPath(target, '__proto__.polluted', 'x')).toThrow(
      /Unsafe mapping target/,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(target).toEqual({});
  });

  it('getMappingPath never returns inherited or prototype values', () => {
    expect(getMappingPath({ a: 1 }, '__proto__')).toBeUndefined();
    expect(getMappingPath({ a: { b: 2 } }, 'a.__proto__.b')).toBeUndefined();
    // `toString` exists on the prototype but is not an own property.
    expect(getMappingPath({ a: 1 }, 'toString')).toBeUndefined();
    expect(getMappingPath({ a: { b: 2 } }, 'a.b')).toBe(2);
  });

  it('validateMappingPaths reports every offending row (config save time)', () => {
    expect(
      validateMappingPaths([
        { source: 'a', target: 'ok' },
        { source: 'a', target: '__proto__.x' },
        { source: 'constructor.y', target: 'ok2' },
      ]),
    ).toEqual(['Unsafe mapping target: "__proto__.x"', 'Unsafe mapping source: "constructor.y"']);
    expect(validateMappingPaths([{ source: 'a.b', target: 'c.d' }])).toEqual([]);
  });
});
