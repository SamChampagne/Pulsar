import { describe, expect, it } from 'vitest';
import { CarrierStatus } from '../enums/transportation';
import { canTransitionCarrier } from './carrier.workflow';

describe('carrier activation', () => {
  it('allows deactivation and reactivation', () => {
    expect(canTransitionCarrier(CarrierStatus.ACTIVE, CarrierStatus.INACTIVE)).toBe(true);
    expect(canTransitionCarrier(CarrierStatus.INACTIVE, CarrierStatus.ACTIVE)).toBe(true);
  });
  it('rejects invalid states and non-transitions', () => {
    expect(canTransitionCarrier(CarrierStatus.ACTIVE, CarrierStatus.ACTIVE)).toBe(false);
    expect(canTransitionCarrier('DELETED' as CarrierStatus, CarrierStatus.ACTIVE)).toBe(false);
  });
});
