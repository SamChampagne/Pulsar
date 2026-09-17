import { describe, expect, it } from 'vitest';

import { parseX12, readGroupHeader, readInterchangeHeader } from './x12';
import { build990, read990 } from './x12-990';

const envelope = {
  senderId: 'PULSARTMS',
  receiverId: 'ACMESHIPPER',
  interchangeControlNumber: 501,
  groupControlNumber: 501,
  transactionControlNumber: 1,
  at: '2026-09-17T09:15',
};

describe('build990', () => {
  it('builds a valid acceptance that parses back cleanly', () => {
    const text = build990(
      { shipmentId: 'SHP-2026-0042', scac: 'CRXY' },
      { accept: true, references: [{ qualifier: 'CN', value: 'TO-2026-0007' }] },
      envelope,
    );
    expect(text).toContain('ST*990*0001~');
    expect(text).toContain('B1*CRXY*SHP-2026-0042*20260917*A~');
    expect(text).toContain('N9*CN*TO-2026-0007~');
    expect(text).toContain('SE*4*0001~');
    expect(text).toContain('GE*1*501~');
    expect(text).toContain('IEA*1*000000501~');

    const { ok, errors, document } = parseX12(text);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
    expect(readInterchangeHeader(document!.isa)).toMatchObject({
      senderId: 'PULSARTMS',
      receiverId: 'ACMESHIPPER',
      date: '260917',
      time: '0915',
      controlNumber: '000000501',
    });
    expect(readGroupHeader(document!.groups[0].gs)).toMatchObject({
      functionalId: 'GF',
      applicationSender: 'PULSARTMS',
      date: '20260917',
      controlNumber: '501',
    });

    const reply = read990(document!.transactions[0]);
    expect(reply).toMatchObject({
      scac: 'CRXY',
      shipmentId: 'SHP-2026-0042',
      date: '2026-09-17',
      action: 'A',
      accepted: true,
      declined: false,
    });
    expect(reply.references).toEqual([
      { qualifier: 'CN', value: 'TO-2026-0007', description: undefined },
    ]);
    expect(reply.reason).toBeUndefined();
  });

  it('builds a decline carrying the reason in K1', () => {
    const text = build990(
      { shipmentId: 'SHP-2026-0042', scac: 'CRXY' },
      { accept: false, reason: 'CAPACITE INSUFFISANTE' },
      envelope,
    );
    expect(text).toContain('B1*CRXY*SHP-2026-0042*20260917*D~');
    expect(text).toContain('K1*CAPACITE INSUFFISANTE~');

    const { ok, document } = parseX12(text);
    expect(ok).toBe(true);
    const reply = read990(document!.transactions[0]);
    expect(reply.accepted).toBe(false);
    expect(reply.declined).toBe(true);
    expect(reply.reason).toBe('CAPACITE INSUFFISANTE');
  });

  it('uses the explicit reply date over the envelope stamp', () => {
    const text = build990(
      { shipmentId: 'SHP-1', scac: 'CRXY' },
      { accept: true, date: '2026-09-18' },
      envelope,
    );
    expect(text).toContain('B1*CRXY*SHP-1*20260918*A~');
  });

  it('omits SCAC and date gracefully when unknown', () => {
    const text = build990(
      { shipmentId: 'SHP-1' },
      { accept: true, date: 'n/a' },
      { ...envelope, at: undefined },
    );
    expect(text).toContain('B1**SHP-1**A~');
    expect(parseX12(text).ok).toBe(true);
  });
});
