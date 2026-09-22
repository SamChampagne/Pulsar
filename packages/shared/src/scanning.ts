/** Scanners are input devices, never an authorization or a stock writer. */
export const SCAN_KINDS = [
  'item',
  'bin',
  'load',
  'shipment',
  'manufacturing-order',
  'yard-visit',
  'dock-appointment',
  'vehicle',
  'trailer',
] as const;
export type ScanKind = (typeof SCAN_KINDS)[number];
export interface ScanResult {
  id: string;
  kind: ScanKind;
  code: string;
  name: string;
  status?: string;
  unit?: string;
  locationId?: string;
  href?: string;
}
export function normalizeScan(raw: string): string {
  const value = raw.replace(/[\r\n\t]+$/, '').trim();
  if (!value || value.length > 128 || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(
      'Scannez un code simple de 1 à 128 caractères. Les données GS1 composites ne sont pas encore prises en charge.',
    );
  return value; // preserve leading zeroes and case
}
export const TOUR_MODULE_KEYS = [
  'hr',
  'quality',
  'support',
  'documentation',
  'catalog',
  'purchasing',
  'services',
  'dashboard',
  'transport',
  'wms',
  'manufacturing',
  'yard',
  'fleet',
  'billing',
  'agents',
  'analytics',
  'crm',
  'sites',
  'customer-portal',
  'procurement',
  'documents',
  'connect',
  'personalize',
  'emails',
  'settings',
] as const;
export type TourModuleKey = (typeof TOUR_MODULE_KEYS)[number];
/** Only substantive, module-specific guide changes should reopen a completed tour. */
export function moduleTourVersion(key: string): number {
  return ['hr', 'quality', 'support', 'purchasing'].includes(key) ? 2 : 1;
}
export interface ModuleTourProgress {
  version: number;
  step: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
}
export type ModuleTours = Partial<Record<TourModuleKey, ModuleTourProgress>>;
