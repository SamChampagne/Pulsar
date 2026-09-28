import { describe, it, expect } from 'vitest';
import {
  LoadStatus,
  ShipmentStatus,
  TransportOrderStatus,
  StopStatus,
  TenderStatus,
  ReceiptStatus,
  PickOrderStatus,
  YardVisitStatus,
  DockAppointmentStatus,
  CustomerInvoiceStatus,
  InvoiceStatus,
  PaymentStatus,
  PortalUserStatus,
  ReleaseNoteKind,
  ReleaseNoteStatus,
} from '@pulsar/shared';
import { labelFor, toneFor, STATUS_LABELS_FR } from './status';

describe('labelFor', () => {
  it('does not render inactive identities or unavailable assets as ready', () => {
    expect(labelFor('INACTIVE')).toBe('Inactif');
    expect(toneFor('INACTIVE')).toBe('neutral');
    expect(toneFor('MAINTENANCE')).toBe('warn');
    expect(toneFor('RETIRED')).toBe('neutral');
    expect(toneFor('AVAILABLE')).toBe('ok');
  });
  it('translates the transport lifecycle', () => {
    expect(labelFor(TransportOrderStatus.IN_EXECUTION)).toBe('En exécution');
    expect(labelFor(ShipmentStatus.IN_TRANSIT)).toBe('En transit');
    expect(labelFor(LoadStatus.TENDERED)).toBe('Offert');
    expect(labelFor(StopStatus.SKIPPED)).toBe('Ignoré');
    expect(labelFor(TenderStatus.DECLINED)).toBe('Refusé');
  });

  it('translates the warehouse, yard, billing and portal vocabularies', () => {
    expect(labelFor(ReceiptStatus.POSTED)).toBe('Enregistrée');
    expect(labelFor(PickOrderStatus.PICKED)).toBe('Prélevée');
    expect(labelFor(YardVisitStatus.CHECKED_IN)).toBe('Arrivé');
    expect(labelFor(DockAppointmentStatus.NO_SHOW)).toBe('Absence');
    expect(labelFor(CustomerInvoiceStatus.SENT)).toBe('Envoyée');
    expect(labelFor(InvoiceStatus.DISPUTED)).toBe('En litige');
    expect(labelFor(PaymentStatus.SUBMITTED)).toBe('Soumis');
    expect(labelFor(PortalUserStatus.INVITED)).toBe('Invité');
    expect(labelFor(ReleaseNoteKind.IMPROVEMENT)).toBe('Amélioration');
    expect(labelFor(ReleaseNoteStatus.PUBLISHED)).toBe('Publiée');
  });

  it('translates the portal change-request lifecycle (spec §B)', () => {
    expect(labelFor('OPEN')).toBe('Ouverte');
    expect(labelFor('ACKNOWLEDGED')).toBe('Prise en compte');
    expect(labelFor('RESOLVED')).toBe('Résolue');
    expect(labelFor('REJECTED')).toBe('Rejetée');
  });

  it('falls back to the humanised English form for an unmapped status', () => {
    expect(labelFor('SOME_NEW_STATUS')).toBe('Some new status');
    expect(labelFor('WAITING')).toBe('Waiting');
  });

  it('returns the raw input unchanged when it is empty', () => {
    expect(labelFor('')).toBe('');
  });

  it('covers every value of the enums it claims to cover', () => {
    const covered = [
      TransportOrderStatus,
      ShipmentStatus,
      LoadStatus,
      StopStatus,
      TenderStatus,
      ReceiptStatus,
      PickOrderStatus,
      YardVisitStatus,
      DockAppointmentStatus,
      CustomerInvoiceStatus,
      InvoiceStatus,
      PaymentStatus,
      PortalUserStatus,
      ReleaseNoteKind,
      ReleaseNoteStatus,
    ];
    const missing = covered
      .flatMap((e) => Object.values(e) as string[])
      .filter((value) => !(value in STATUS_LABELS_FR));
    expect(missing).toEqual([]);
  });
});

describe('toneFor', () => {
  it('keeps the existing tones', () => {
    expect(toneFor(LoadStatus.IN_TRANSIT)).toBe('info');
    expect(toneFor(TenderStatus.DECLINED)).toBe('danger');
    expect(toneFor('DRAFT')).toBe('neutral');
  });

  it('adds the tones the audit found missing', () => {
    expect(toneFor(TransportOrderStatus.IN_EXECUTION)).toBe('info');
    expect(toneFor(TransportOrderStatus.CLOSED)).toBe('neutral');
    expect(toneFor('ACKNOWLEDGED')).toBe('info');
    expect(toneFor('RESOLVED')).toBe('ok');
    expect(toneFor('REJECTED')).toBe('danger');
  });

  it('falls back to neutral for an unknown status', () => {
    expect(toneFor('SOME_NEW_STATUS')).toBe('neutral');
  });
});
