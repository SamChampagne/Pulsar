import { describe, expect, it } from 'vitest';

import multistop204 from './__fixtures__/204-multistop.edi?raw';
import minimal204 from './__fixtures__/204-minimal.edi?raw';
import invoice210 from './__fixtures__/210-invoice.edi?raw';
import {
  buildX12Interchange,
  fromImpliedDecimal,
  parseX12,
  readGroupHeader,
  readInterchangeHeader,
  serializeX12,
  toImpliedDecimal,
  x12DateTimeToIso,
  x12Element,
  x12Segment,
  x12Stamp,
} from './x12';

describe('parseX12', () => {
  it('detects the separators on the ISA header', () => {
    const { ok, errors, document } = parseX12(multistop204);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
    expect(document?.separators.element).toBe('*');
    expect(document?.separators.subElement).toBe('>');
    expect(document?.separators.segment).toBe('~');
    expect(document?.separators.repetition).toBeUndefined();
    expect(document?.separators.eol).toBe('\n');
  });

  it('exposes the ISA / GS / ST envelopes', () => {
    const { document } = parseX12(multistop204);
    const isa = readInterchangeHeader(document!.isa);
    expect(isa.senderId).toBe('ACMESHIPPER');
    expect(isa.receiverId).toBe('PULSARTMS');
    expect(isa.controlNumber).toBe('000000101');
    expect(isa.usageIndicator).toBe('P');

    expect(document!.groups).toHaveLength(1);
    const gs = readGroupHeader(document!.groups[0].gs);
    expect(gs.functionalId).toBe('SM');
    expect(gs.controlNumber).toBe('101');

    expect(document!.transactions).toHaveLength(1);
    const tx = document!.transactions[0];
    expect(tx.transactionSetId).toBe('204');
    expect(tx.controlNumber).toBe('0001');
    expect(tx.functionalId).toBe('SM');
    // 49 segments in the fixture: ISA, GS, ST, 43 body segments, SE, GE, IEA.
    expect(tx.segments).toHaveLength(43);
    expect(tx.segments[0].tag).toBe('B2');
    expect(x12Element(tx.segments[0], 4)).toBe('SHP-2026-0042');
  });

  it('tolerates CRLF line breaks and remembers them', () => {
    const crlf = minimal204.replace(/\n/g, '\r\n');
    const { ok, document } = parseX12(crlf);
    expect(ok).toBe(true);
    expect(document?.separators.eol).toBe('\r\n');
    expect(serializeX12(document!)).toBe(crlf);
  });

  it('tolerates a single-line interchange (no line breaks at all)', () => {
    const oneLine = minimal204.replace(/\n/g, '');
    const { ok, document } = parseX12(oneLine);
    expect(ok).toBe(true);
    expect(document?.separators.eol).toBe('');
    expect(document?.transactions[0].segments).toHaveLength(10);
  });

  it('reads the repetition separator on 00402+ interchanges only', () => {
    const base = minimal204;
    const with402 = base.replace('*U*00401*', '*^*00501*');
    expect(parseX12(with402).document?.separators.repetition).toBe('^');
    const with401 = base.replace('*U*00401*', '*^*00401*');
    expect(parseX12(with401).document?.separators.repetition).toBeUndefined();
    // `U` means "no repetition in use" even on 00402+.
    expect(
      parseX12(base.replace('*00401*', '*00501*')).document?.separators.repetition,
    ).toBeUndefined();
  });
});

describe('parseX12 errors', () => {
  it('never throws on garbage input', () => {
    expect(parseX12('').errors[0].code).toBe('EMPTY_INPUT');
    expect(parseX12('bonjour').errors[0].code).toBe('MISSING_ISA');
    expect(parseX12('ISA*00*too short~').errors[0].code).toBe('ISA_TOO_SHORT');
  });

  it('reports a mis-padded ISA header', () => {
    // Drop one space out of the 15-character sender id: every following offset shifts.
    const broken = minimal204.replace('*ACMESHIPPER    *ZZ*', '*ACMESHIPPER   *ZZ*');
    const result = parseX12(broken);
    expect(result.ok).toBe(false);
    expect(result.document).toBeNull();
    expect(result.errors[0].code).toBe('ISA_MALFORMED');
  });

  it('reports an SE segment count mismatch but still returns the transaction', () => {
    const broken = minimal204.replace('SE*12*0001', 'SE*99*0001');
    const result = parseX12(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain('SE_COUNT_MISMATCH');
    expect(result.errors[0].message).toContain('99');
    expect(result.document?.transactions).toHaveLength(1);
  });

  it('reports a control-number mismatch between SE02 and ST02', () => {
    const broken = minimal204.replace('SE*12*0001', 'SE*12*0002');
    expect(parseX12(broken).errors.map((error) => error.code)).toContain('ST_CONTROL_MISMATCH');
  });

  it('reports a missing IEA trailer', () => {
    const broken = minimal204.replace(/IEA\*1\*000000102~\n/, '');
    const result = parseX12(broken);
    expect(result.errors.map((error) => error.code)).toContain('MISSING_IEA');
    expect(result.document?.transactions).toHaveLength(1);
  });

  it('reports a GE transaction count mismatch and an IEA group count mismatch', () => {
    expect(
      parseX12(minimal204.replace('GE*1*102', 'GE*4*102')).errors.map((error) => error.code),
    ).toContain('GE_COUNT_MISMATCH');
    expect(
      parseX12(minimal204.replace('IEA*1*000000102', 'IEA*3*000000102')).errors.map(
        (error) => error.code,
      ),
    ).toContain('IEA_COUNT_MISMATCH');
  });

  it('reports an interchange control number mismatch', () => {
    expect(
      parseX12(minimal204.replace('IEA*1*000000102', 'IEA*1*000000999')).errors.map(
        (error) => error.code,
      ),
    ).toContain('ISA_CONTROL_MISMATCH');
  });
});

describe('serializeX12', () => {
  it('round-trips every fixture byte for byte', () => {
    for (const fixture of [multistop204, minimal204, invoice210]) {
      const { document } = parseX12(fixture);
      expect(serializeX12(document!)).toBe(fixture);
    }
  });

  it('recomputes SE01, GE01 and IEA01 from the actual content', () => {
    const { document } = parseX12(minimal204.replace('SE*12*0001', 'SE*99*0001'));
    const text = serializeX12(document!);
    expect(text).toContain('SE*12*0001~');
    expect(parseX12(text).ok).toBe(true);
  });

  it('honours partner separators end to end', () => {
    const text = buildX12Interchange(
      {
        senderId: 'PULSARTMS',
        receiverId: 'ACMESHIPPER',
        interchangeControlNumber: 7,
        groupControlNumber: 7,
        transactionControlNumber: 1,
        at: '2026-09-17T09:15',
        separators: { element: '|', subElement: ':', segment: "'" },
      },
      'GF',
      '990',
      [x12Segment('B1', 'CRXY', 'SHP-1', '20260917', 'A')],
    );
    expect(text.startsWith('ISA|00|')).toBe(true);
    expect(text.endsWith("IEA|1|000000007'")).toBe(true);
    const parsed = parseX12(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.document?.separators.segment).toBe("'");
    expect(serializeX12(parsed.document!)).toBe(text);
  });
});

describe('value helpers', () => {
  it('converts implied-decimal money both ways', () => {
    expect(fromImpliedDecimal('268550')).toBe(2685.5);
    expect(fromImpliedDecimal('9800')).toBe(98);
    expect(fromImpliedDecimal('-12345')).toBe(-123.45);
    expect(fromImpliedDecimal('2685.50')).toBe(2685.5);
    expect(fromImpliedDecimal('')).toBeUndefined();
    expect(fromImpliedDecimal('abc')).toBeUndefined();
    expect(toImpliedDecimal(2685.5)).toBe('268550');
    expect(toImpliedDecimal(undefined)).toBe('');
  });

  it('stamps dates without shifting timezones for plain ISO strings', () => {
    expect(x12Stamp('2026-09-17T09:15')).toEqual({
      date: '20260917',
      shortDate: '260917',
      time: '0915',
    });
    expect(x12Stamp(new Date(Date.UTC(2026, 8, 17, 9, 15)))).toEqual({
      date: '20260917',
      shortDate: '260917',
      time: '0915',
    });
    expect(x12Stamp('pas une date')).toEqual({ date: '', shortDate: '', time: '' });
  });

  it('reads X12 dates back to ISO', () => {
    expect(x12DateTimeToIso('20260921', '0800')).toBe('2026-09-21T08:00');
    expect(x12DateTimeToIso('20260921', undefined)).toBe('2026-09-21');
    expect(x12DateTimeToIso(undefined, '0800')).toBeUndefined();
  });

  it('drops trailing empty elements when building a segment', () => {
    expect(x12Segment('AT7', 'X3', undefined, undefined, undefined, '20260921', '0800')).toEqual({
      tag: 'AT7',
      elements: ['X3', '', '', '', '20260921', '0800'],
    });
    expect(x12Segment('MS1', 'MONTREAL', undefined)).toEqual({
      tag: 'MS1',
      elements: ['MONTREAL'],
    });
  });
});
