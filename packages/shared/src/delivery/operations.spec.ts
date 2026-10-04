import { describe, expect, it } from 'vitest';
import { nextDeliveryOperation, type DeliveryOperationRow } from './operations';

const row: Omit<DeliveryOperationRow, 'nextAction'> = {
  id: 'load',
  loadNumber: 'LD-1',
  status: 'PLANNED',
  updatedAt: '2026-10-03T12:00:00Z',
  shipmentCount: 1,
  shipmentsWithoutPackages: 0,
  packages: { total: 1, prepared: 1, loaded: 0, delivered: 0, returned: 0, cancelled: 0 },
  exceptions: { open: 0, retry: 0, returnAuthorized: 0, returnReceived: 0 },
};
describe('next delivery operation guidance', () => {
  it('prioritizes human review over physical execution', () =>
    expect(
      nextDeliveryOperation({ ...row, exceptions: { ...row.exceptions, open: 1, retry: 2 } }).label,
    ).toBe('Examiner les incidents'));
  it('distinguishes authorized and physically received returns', () => {
    expect(
      nextDeliveryOperation({ ...row, exceptions: { ...row.exceptions, returnAuthorized: 1 } })
        .label,
    ).toBe('Vérifier la réception du retour');
    expect(
      nextDeliveryOperation({
        ...row,
        status: 'COMPLETED',
        exceptions: { ...row.exceptions, returnReceived: 1 },
      }).reason,
    ).toContain('aucun remboursement ni mouvement WMS');
  });
  it('does not require parcel tracking on all legacy shipments', () =>
    expect(nextDeliveryOperation({ ...row, shipmentsWithoutPackages: 1 }).reason).toContain(
      'facultatif',
    ));
  it('guides loaded and in-transit records without changing any input', () => {
    const input = structuredClone(row);
    expect(nextDeliveryOperation(input).label).toBe('Vérifier les colis à charger');
    expect(input).toEqual(row);
    expect(
      nextDeliveryOperation({
        ...row,
        status: 'IN_TRANSIT',
        packages: { ...row.packages, prepared: 0, loaded: 1 },
      }).label,
    ).toBe('Suivre les remises');
  });
  it('closed records point to history and safely encode IDs', () => {
    expect(nextDeliveryOperation({ ...row, id: 'a/b', status: 'COMPLETED' })).toMatchObject({
      href: '/loads/a%2Fb',
      label: 'Consulter le dossier',
    });
  });
});
