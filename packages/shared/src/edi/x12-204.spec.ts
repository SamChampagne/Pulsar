import { describe, expect, it } from 'vitest';

import multistop204 from './__fixtures__/204-multistop.edi?raw';
import minimal204 from './__fixtures__/204-minimal.edi?raw';
import { parseX12, type X12Transaction } from './x12';
import { read204 } from './x12-204';

function transactionOf(text: string): X12Transaction {
  const { ok, document } = parseX12(text);
  expect(ok).toBe(true);
  return document!.transactions[0];
}

describe('read204 — multi-stop tender', () => {
  const tender = read204(transactionOf(multistop204));

  it('reads the B2 / B2A header', () => {
    expect(tender.shipmentId).toBe('SHP-2026-0042');
    expect(tender.scac).toBe('CRXY');
    expect(tender.methodOfPayment).toBe('PP');
    expect(tender.purposeCode).toBe('00');
    expect(tender.purpose).toBe('ORIGINAL');
    expect(tender.applicationType).toBe('LT');
  });

  it('reads the header references, contacts and notes', () => {
    expect(tender.references).toEqual([
      { qualifier: 'PO', value: 'PO-88231', description: undefined },
      { qualifier: 'CR', value: 'CUST-ACME', description: undefined },
    ]);
    expect(tender.contacts).toEqual([
      {
        functionCode: 'IC',
        name: 'MARIE TREMBLAY',
        communicationQualifier: 'TE',
        communicationNumber: '5145550199',
      },
    ]);
    expect(tender.notes).toEqual(['CHARGEMENT EN DEUX RAMASSES']);
  });

  it('reads the N7 equipment', () => {
    expect(tender.equipment).toHaveLength(1);
    expect(tender.equipment[0]).toMatchObject({
      initial: 'CRXY',
      number: '53101',
      weight: 42000,
      weightQualifier: 'G',
      descriptionCode: 'TL',
    });
  });

  it('splits the four stops into two pickups and two deliveries', () => {
    expect(tender.stops).toHaveLength(4);
    expect(tender.stops.map((stop) => stop.type)).toEqual([
      'PICKUP',
      'PICKUP',
      'DELIVERY',
      'DELIVERY',
    ]);
    expect(tender.stops.map((stop) => stop.sequence)).toEqual([1, 2, 3, 4]);
    expect(tender.stops.map((stop) => stop.reasonCode)).toEqual(['CL', 'CL', 'CU', 'CU']);
  });

  it('reads the first pickup in full', () => {
    const stop = tender.stops[0];
    expect(stop.name).toBe('ACME MANUFACTURING');
    expect(stop.entityCode).toBe('SH');
    expect(stop.idCode).toBe('ACME-MTL');
    expect(stop.address1).toBe('1200 RUE NOTRE-DAME OUEST');
    expect(stop.city).toBe('MONTREAL');
    expect(stop.state).toBe('QC');
    expect(stop.postalCode).toBe('H3C1K3');
    expect(stop.country).toBe('CA');
    expect(stop.weight).toBe(18000);
    expect(stop.weightUnit).toBe('L');
    expect(stop.quantity).toBe(12);
    expect(stop.quantityUnit).toBe('PL');
    expect(stop.earliestAt).toBe('2026-09-21T08:00');
    expect(stop.latestAt).toBe('2026-09-21T16:00');
    expect(stop.dates).toHaveLength(2);
    expect(stop.dates[0]).toMatchObject({
      qualifier: '10',
      date: '2026-09-21',
      time: '08:00',
      timeCode: 'LT',
    });
    expect(stop.references).toEqual([
      { qualifier: 'PU', value: 'PU-1001', description: undefined },
    ]);
    expect(stop.contacts[0].name).toBe('LUC GAGNON');
    expect(stop.notes).toEqual(['QUAI 4 - SE PRESENTER AU BUREAU']);
  });

  it('reads the lading items of the first pickup (L5 + OID + LAD)', () => {
    const [item] = tender.stops[0].items;
    expect(item).toMatchObject({
      lineNumber: 1,
      description: 'PALETTES DE BOISSONS',
      commodityCode: '4839',
      referenceId: 'ORD-5501',
      purchaseOrderNumber: 'PO-88231',
      quantity: 12,
      quantityUnit: 'PL',
      weight: 18000,
      weightUnit: 'L',
      packagingCode: 'PLT',
    });
  });

  it('reads the deliveries with their appointment windows', () => {
    const toronto = tender.stops[2];
    expect(toronto.name).toBe('LOBLAW DC TORONTO');
    expect(toronto.city).toBe('TORONTO');
    expect(toronto.state).toBe('ON');
    expect(toronto.earliestAt).toBe('2026-09-22T07:00');
    expect(toronto.latestAt).toBe('2026-09-22T15:00');
    expect(toronto.notes).toEqual(['RENDEZ-VOUS OBLIGATOIRE']);

    const mississauga = tender.stops[3];
    expect(mississauga.name).toBe('CANADIAN TIRE MISSISSAUGA');
    expect(mississauga.city).toBe('MISSISSAUGA');
    expect(mississauga.earliestAt).toBeUndefined();
    expect(mississauga.latestAt).toBe('2026-09-22T17:00');
    expect(mississauga.weight).toBe(6000);
  });

  it('totals the pickup weights', () => {
    expect(tender.totalWeight).toBe(24000);
    expect(tender.weightUnit).toBe('L');
  });
});

describe('read204 — minimal tender', () => {
  const tender = read204(transactionOf(minimal204));

  it('reads one pickup and one delivery', () => {
    expect(tender.shipmentId).toBe('SHP-2026-0043');
    expect(tender.purpose).toBe('ORIGINAL');
    expect(tender.equipment).toEqual([]);
    expect(tender.references).toEqual([]);
    expect(tender.stops).toHaveLength(2);
    expect(tender.stops[0]).toMatchObject({
      type: 'PICKUP',
      city: 'MONTREAL',
      weight: 9000,
      earliestAt: '2026-09-23T09:00',
    });
    expect(tender.stops[0].latestAt).toBeUndefined();
    expect(tender.stops[1]).toMatchObject({
      type: 'DELIVERY',
      city: 'TORONTO',
      latestAt: '2026-09-24T14:00',
    });
    expect(tender.stops[1].items).toEqual([]);
  });
});

describe('read204 — degraded input', () => {
  it('never throws on a transaction with no recognised segment', () => {
    const tender = read204({
      st: { tag: 'ST', elements: ['204', '0001'] },
      segments: [{ tag: 'ZZZ', elements: ['x'] }],
      transactionSetId: '204',
      controlNumber: '0001',
      functionalId: 'SM',
    });
    expect(tender.shipmentId).toBe('');
    expect(tender.purpose).toBe('UNKNOWN');
    expect(tender.stops).toEqual([]);
    expect(tender.totalWeight).toBeUndefined();
  });

  it('flags an unknown B2A purpose code instead of guessing', () => {
    const tender = read204({
      st: { tag: 'ST', elements: ['204', '0001'] },
      segments: [
        { tag: 'B2', elements: ['', 'CRXY', '', 'SHP-9'] },
        { tag: 'B2A', elements: ['ZZ'] },
      ],
      transactionSetId: '204',
      controlNumber: '0001',
      functionalId: 'SM',
    });
    expect(tender.purposeCode).toBe('ZZ');
    expect(tender.purpose).toBe('UNKNOWN');
    expect(tender.shipmentId).toBe('SHP-9');
  });
});
