import { describe, expect, it } from 'vitest';

import { ShipmentStatus, TrackingEventType } from '../enums/transportation';
import { parseX12, readGroupHeader } from './x12';
import {
  at7ForShipmentStatus,
  at7ForTrackingEvent,
  build214,
  isX12StatusCode,
  read214,
  X12_214_STATUS_CODES,
} from './x12-214';

const envelope = {
  senderId: 'PULSARTMS',
  receiverId: 'ACMESHIPPER',
  interchangeControlNumber: 601,
  groupControlNumber: 601,
  transactionControlNumber: 1,
  at: '2026-09-21T17:45',
};

describe('AT7 status code map', () => {
  it('maps Pulsar shipment statuses', () => {
    expect(at7ForShipmentStatus(ShipmentStatus.PENDING)).toBeUndefined();
    expect(at7ForShipmentStatus(ShipmentStatus.PLANNED)).toBe('AA');
    expect(at7ForShipmentStatus(ShipmentStatus.DISPATCHED)).toBe('AM');
    expect(at7ForShipmentStatus(ShipmentStatus.IN_TRANSIT)).toBe('X6');
    expect(at7ForShipmentStatus(ShipmentStatus.DELIVERED)).toBe('D1');
    expect(at7ForShipmentStatus(ShipmentStatus.CLOSED)).toBe('D1');
    expect(at7ForShipmentStatus(ShipmentStatus.CANCELLED)).toBe('CA');
  });

  it('maps tracking events, disambiguating arrivals and departures by stop type', () => {
    expect(at7ForTrackingEvent(TrackingEventType.ARRIVED_AT_STOP)).toBe('X3');
    expect(at7ForTrackingEvent(TrackingEventType.ARRIVED_AT_STOP, { stopType: 'PICKUP' })).toBe(
      'X3',
    );
    expect(at7ForTrackingEvent(TrackingEventType.ARRIVED_AT_STOP, { stopType: 'DELIVERY' })).toBe(
      'X1',
    );
    expect(at7ForTrackingEvent(TrackingEventType.DEPARTED_STOP, { stopType: 'PICKUP' })).toBe('AF');
    expect(at7ForTrackingEvent(TrackingEventType.DEPARTED_STOP, { stopType: 'DELIVERY' })).toBe(
      'CD',
    );
    expect(at7ForTrackingEvent(TrackingEventType.DELIVERED)).toBe('D1');
    expect(at7ForTrackingEvent(TrackingEventType.DELAYED)).toBe('SD');
    expect(at7ForTrackingEvent(TrackingEventType.CREATED)).toBeUndefined();
  });

  it('exposes a documented, closed set of codes', () => {
    expect(isX12StatusCode('AF')).toBe(true);
    expect(isX12StatusCode('ZZ')).toBe(false);
    expect(X12_214_STATUS_CODES.AF).toBe('Carrier departed pick-up location with shipment');
    expect(Object.keys(X12_214_STATUS_CODES)).toHaveLength(16);
  });
});

describe('build214', () => {
  const text = build214(
    {
      referenceNumber: 'SH-2026-0042',
      shipmentId: 'SHP-2026-0042',
      scac: 'CRXY',
      equipmentNumber: '53101',
      references: [{ qualifier: 'PO', value: 'PO-88231' }],
      events: [
        {
          code: 'X3',
          at: '2026-09-21T07:45',
          city: 'MONTREAL',
          state: 'QC',
          country: 'CA',
        },
        { code: 'AF', at: '2026-09-21T08:30', city: 'MONTREAL', state: 'QC' },
        { code: 'AG', at: '2026-09-22T14:00', city: 'TORONTO', state: 'ON' },
      ],
    },
    envelope,
  );

  it('emits one LX loop per status', () => {
    expect(text).toContain('ST*214*0001~');
    expect(text).toContain('B10*SH-2026-0042*SHP-2026-0042*CRXY~');
    expect(text).toContain('L11*PO-88231*PO~');
    expect(text).toContain('LX*1~');
    expect(text).toContain('AT7*X3****20260921*0745*LT~');
    expect(text).toContain('MS1*MONTREAL*QC*CA~');
    expect(text).toContain('MS2*CRXY*53101~');
    expect(text).toContain('LX*3~');
    expect(text).toContain('AT7*AG****20260922*1400*LT~');
  });

  it('parses back to the expected fields', () => {
    const { ok, errors, document } = parseX12(text);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
    expect(readGroupHeader(document!.groups[0].gs).functionalId).toBe('QM');

    const status = read214(document!.transactions[0]);
    expect(status.referenceNumber).toBe('SH-2026-0042');
    expect(status.shipmentId).toBe('SHP-2026-0042');
    expect(status.scac).toBe('CRXY');
    expect(status.references).toEqual([
      { qualifier: 'PO', value: 'PO-88231', description: undefined },
    ]);
    expect(status.events).toHaveLength(3);
    expect(status.events[0]).toEqual({
      code: 'X3',
      description: 'Arrived at pick-up location',
      reasonCode: undefined,
      at: '2026-09-21T07:45',
      timeCode: 'LT',
      city: 'MONTREAL',
      state: 'QC',
      country: 'CA',
      equipmentNumber: '53101',
    });
    expect(status.events[2]).toMatchObject({
      code: 'AG',
      description: 'Estimated delivery',
      at: '2026-09-22T14:00',
      city: 'TORONTO',
    });
  });

  it('builds a delivery message from Pulsar tracking events', () => {
    const delivered = build214(
      {
        shipmentId: 'SHP-2026-0042',
        scac: 'CRXY',
        events: [
          {
            code: at7ForTrackingEvent(TrackingEventType.ARRIVED_AT_STOP, { stopType: 'DELIVERY' })!,
            at: '2026-09-22T13:10',
            city: 'TORONTO',
            state: 'ON',
          },
          {
            code: at7ForTrackingEvent(TrackingEventType.DELIVERED)!,
            reasonCode: 'NS',
            at: '2026-09-22T14:05',
            city: 'TORONTO',
            state: 'ON',
          },
        ],
      },
      envelope,
    );
    expect(delivered).toContain('AT7*X1****20260922*1310*LT~');
    expect(delivered).toContain('AT7*D1*NS***20260922*1405*LT~');
    const { ok, document } = parseX12(delivered);
    expect(ok).toBe(true);
    const status = read214(document!.transactions[0]);
    expect(status.events.map((event) => event.code)).toEqual(['X1', 'D1']);
    expect(status.events[1].reasonCode).toBe('NS');
  });

  it('omits the date elements when the timestamp is unusable', () => {
    const text2 = build214(
      { shipmentId: 'SHP-1', events: [{ code: 'X6', at: undefined }] },
      envelope,
    );
    expect(text2).toContain('AT7*X6~');
    expect(parseX12(text2).ok).toBe(true);
  });
});
