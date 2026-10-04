import { describe, expect, it } from 'vitest';
import {
  DeliveryExceptionStatus as S,
  canTransitionDeliveryException,
  deliveryExceptionNextAction,
} from './exceptions';
import {
  DeliveryPackageStatus as P,
  canTransitionDeliveryPackage,
  deriveDeliveryPackageCounts,
} from './packages';
describe('physical delivery incidents', () => {
  it('requires authorization before receipt, terminal receipts cannot be reopened', () => {
    expect(canTransitionDeliveryException(S.OPEN, S.RETURN_RECEIVED)).toBe(false);
    expect(canTransitionDeliveryException(S.OPEN, S.RETURN_AUTHORIZED)).toBe(true);
    expect(canTransitionDeliveryException(S.RETURN_AUTHORIZED, S.RETURN_RECEIVED)).toBe(true);
    for (const to of Object.values(S))
      expect(canTransitionDeliveryException(S.RETURN_RECEIVED, to)).toBe(false);
  });
  it('retry can be delivered/resolved or sent back to human review', () => {
    expect(canTransitionDeliveryException(S.RETRY_PLANNED, S.RESOLVED)).toBe(true);
    expect(canTransitionDeliveryException(S.RETRY_PLANNED, S.OPEN)).toBe(true);
    expect(deliveryExceptionNextAction(S.RETURN_RECEIVED)).toBeTruthy();
  });
  it('returned is a physical terminal distinct from delivered and cancelled', () => {
    expect(canTransitionDeliveryPackage(P.PREPARED, P.RETURNED)).toBe(false);
    expect(canTransitionDeliveryPackage(P.LOADED, P.RETURNED)).toBe(true);
    expect(canTransitionDeliveryPackage(P.RETURNED, P.LOADED)).toBe(false);
    const counts = deriveDeliveryPackageCounts([{ status: P.RETURNED }, { status: P.DELIVERED }]);
    expect(counts).toMatchObject({ active: 2, delivered: 1, returned: 1 });
  });
});
