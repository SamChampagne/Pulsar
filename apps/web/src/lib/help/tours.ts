import { writable } from 'svelte/store';
import type { ModuleTourProgress } from '@pulsar/shared';
export const tourRequest = writable(0);
export function requestModuleTour() {
  tourRequest.update((n) => n + 1);
}
export function shouldStartTour(progress?: ModuleTourProgress): boolean {
  // A module is introduced once per user, not again after upgrades or unfinished visits.
  return !progress;
}
/** Preferred preparation and execution screens; filtered against the user's visible navigation. */
export const TOUR_ROUTES: Record<string, string[]> = {
  hr: ['/hr/employees', '/hr/leaves', '/hr/self'],
  quality: ['/quality/plans', '/quality', '/quality/nonconformities'],
  support: ['/support'],
  documentation: ['/documentation'],
  catalog: ['/catalog/partners', '/catalog'],
  purchasing: ['/purchasing'],
  services: ['/services/quotes', '/services', '/services/planning', '/services/time'],
  dashboard: ['/apps', '/dashboard'],
  transport: ['/customers', '/dispatch'],
  wms: ['/wms/bins', '/wms/receiving'],
  manufacturing: ['/manufacturing/calendars', '/manufacturing/orders'],
  yard: ['/yard/spots', '/yard/appointments'],
  fleet: ['/fleet/register', '/fleet'],
  billing: ['/billing/config', '/invoices'],
  agents: ['/settings/agent-runtime', '/agents'],
  analytics: ['/analytics/scorecards', '/analytics/flow'],
  crm: ['/crm/contacts', '/crm/pipeline'],
  sites: ['/sites'],
  'customer-portal': ['/customer-portal/requests'],
  procurement: ['/procurement/rfps'],
  documents: ['/documents'],
  connect: ['/connect', '/integrations'],
  personalize: ['/personalize'],
  emails: ['/emails/templates', '/emails'],
  settings: ['/settings/users', '/settings/roles'],
};
