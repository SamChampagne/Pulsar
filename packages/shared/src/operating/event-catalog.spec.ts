import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENT_CATALOG, domainEventCatalogEntry } from './event-catalog';
import { DOMAIN_EVENT_TYPES } from './policies';
import { moduleOfEventType } from '../analytics/flow';

describe('domain event catalog', () => {
  it('has no duplicate event type', () => {
    const types = DOMAIN_EVENT_CATALOG.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('covers every DOMAIN_EVENT_TYPES constant', () => {
    const types = new Set(DOMAIN_EVENT_CATALOG.map((e) => e.type));
    for (const type of Object.values(DOMAIN_EVENT_TYPES)) {
      expect(types.has(type)).toBe(true);
    }
  });

  it('documents the types emitted outside the constant map', () => {
    for (const type of [
      'crm.deal.won',
      'crm.sales_order.confirmed',
      'crm.sales_order.invoiced',
      'crm.email.received',
      'connect.import-batch.completed',
      'connect.carrier-invoice.ingested',
      'sites.lead.captured',
    ]) {
      expect(domainEventCatalogEntry(type)).toBeDefined();
    }
  });

  it('derives the module from moduleOfEventType (rule 37)', () => {
    for (const entry of DOMAIN_EVENT_CATALOG) {
      expect(entry.module).toBe(moduleOfEventType(entry.type));
    }
    expect(domainEventCatalogEntry('wms.pick.completed')!.module).toBe('WMS');
    expect(domainEventCatalogEntry('portal.change-request')!.module).toBe('CUSTOMER_PORTAL');
  });

  it('every entry carries a FR description and a non-empty example', () => {
    for (const entry of DOMAIN_EVENT_CATALOG) {
      expect(entry.description.length).toBeGreaterThan(10);
      expect(Object.keys(entry.example).length).toBeGreaterThan(0);
    }
  });

  it('returns undefined for an unknown type', () => {
    expect(domainEventCatalogEntry('nope.not.a.thing')).toBeUndefined();
  });
});
