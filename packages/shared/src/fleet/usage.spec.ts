import { describe, it, expect } from 'vitest';
import { costPerKm, fuelEfficiencyPer100Km, workOrderTotal, partsSubtotal, FuelUnit } from './usage';
import {
  canTransitionInspection,
  deriveInspectionStatus,
  InspectionStatus,
  InspectionResult,
} from './inspection';

describe('fleet usage helpers', () => {
  it('costPerKm divides and rounds, guards bad distance', () => {
    expect(costPerKm(1000, 4000)).toBe(0.25);
    expect(costPerKm(1000, 0)).toBeNull();
    expect(costPerKm(1000, -5)).toBeNull();
  });

  it('fuelEfficiencyPer100Km converts gallons and computes L/100km', () => {
    expect(fuelEfficiencyPer100Km(40, FuelUnit.L, 400)).toBe(10);
    // 10 gal ≈ 37.854 L over 100 km → ~37.85 /100km
    expect(fuelEfficiencyPer100Km(10, FuelUnit.GAL, 100)).toBe(37.85);
    expect(fuelEfficiencyPer100Km(40, FuelUnit.L, 0)).toBeNull();
  });

  it('workOrderTotal sums parts + labour, treats missing as 0', () => {
    expect(workOrderTotal({ partsCost: 120.5, laborHours: 2, laborRate: 80 })).toBe(280.5);
    expect(workOrderTotal({ laborHours: 1.5, laborRate: 100 })).toBe(150);
    expect(workOrderTotal({})).toBe(0);
  });

  it('partsSubtotal multiplies qty × unitCost', () => {
    expect(partsSubtotal([{ qty: 2, unitCost: 10 }, { qty: 3, unitCost: 5.5 }])).toBe(36.5);
    expect(partsSubtotal([])).toBe(0);
  });
});

describe('inspection helpers', () => {
  it('deriveInspectionStatus fails on any FAIL, passes otherwise', () => {
    expect(deriveInspectionStatus([{ result: InspectionResult.PASS }])).toBe(InspectionStatus.PASSED);
    expect(
      deriveInspectionStatus([{ result: InspectionResult.PASS }, { result: InspectionResult.FAIL }]),
    ).toBe(InspectionStatus.FAILED);
    expect(deriveInspectionStatus([{ result: InspectionResult.NA }])).toBe(InspectionStatus.PASSED);
    expect(deriveInspectionStatus([])).toBe(InspectionStatus.PASSED);
  });

  it('canTransitionInspection only DRAFT → PASSED/FAILED', () => {
    expect(canTransitionInspection(InspectionStatus.DRAFT, InspectionStatus.PASSED)).toBe(true);
    expect(canTransitionInspection(InspectionStatus.DRAFT, InspectionStatus.FAILED)).toBe(true);
    expect(canTransitionInspection(InspectionStatus.PASSED, InspectionStatus.FAILED)).toBe(false);
  });
});
