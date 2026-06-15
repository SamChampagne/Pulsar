import { describe, expect, it } from 'vitest';
import {
  buildIntegrationRoadmap,
  computeIntegrationHealth,
  integrationAttentionRank,
  inferIntegrationKind,
  summarizeIntegrationReadiness,
} from './operations';

describe('integration operations helpers', () => {
  it('marks enabled connectors with sustained delivery failures as degraded', () => {
    const health = computeIntegrationHealth({
      key: 'erp-odoo',
      name: 'Odoo ERP',
      status: 'ENABLED',
      kind: 'erp',
      requiredCapabilities: ['orders.import', 'invoices.export'],
      capabilities: ['orders.import', 'invoices.export'],
      deliveryStats: {
        last24h: 20,
        failedLast24h: 5,
        lastFailureAt: '2026-06-15T12:00:00.000Z',
        lastSuccessAt: '2026-06-15T10:00:00.000Z',
      },
    });

    expect(health.state).toBe('degraded');
    expect(health.severity).toBe('warning');
    expect(health.reason).toContain('25%');
    expect(health.nextStep).toContain('livraisons échouées');
  });

  it('blocks business-critical connectors when required capabilities are missing', () => {
    const health = computeIntegrationHealth({
      key: 'quickbooks',
      name: 'QuickBooks',
      status: 'ENABLED',
      kind: 'accounting',
      requiredCapabilities: ['customer-invoices.export', 'payments.import'],
      capabilities: ['customer-invoices.export'],
      deliveryStats: { last24h: 0, failedLast24h: 0 },
    });

    expect(health.state).toBe('blocked');
    expect(health.severity).toBe('critical');
    expect(health.reason).toContain('payments.import');
    expect(integrationAttentionRank(health)).toBeGreaterThan(900);
  });

  it('summarizes integration readiness with attention-first ordering', () => {
    const summary = summarizeIntegrationReadiness([
      {
        key: 'webhook-carrier',
        name: 'Carrier Webhook',
        status: 'ENABLED',
        kind: 'webhook',
        deliveryStats: { last24h: 4, failedLast24h: 0, lastSuccessAt: '2026-06-15T11:00:00.000Z' },
      },
      {
        key: 'telematics',
        name: 'Telematics',
        status: 'DISABLED',
        kind: 'telematics',
        requiredCapabilities: ['positions.import'],
        capabilities: [],
        deliveryStats: { last24h: 0, failedLast24h: 0 },
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.live).toBe(1);
    expect(summary.notConfigured).toBe(1);
    expect(summary.attention[0].key).toBe('telematics');
    expect(summary.attention[0].health.state).toBe('not_configured');
  });

  it('infers connector kinds from existing integration keys and names', () => {
    expect(inferIntegrationKind('odoo-prod', 'Odoo ERP')).toBe('erp');
    expect(inferIntegrationKind('quickbooks', 'Accounting sync')).toBe('accounting');
    expect(inferIntegrationKind('samsara', 'Truck GPS')).toBe('telematics');
    expect(inferIntegrationKind('edi-214', 'Shipment status EDI')).toBe('edi');
    expect(inferIntegrationKind('custom-hook', 'Customer webhook')).toBe('webhook');
  });

  it('builds a future integration roadmap from connector kinds', () => {
    const roadmap = buildIntegrationRoadmap([
      { key: 'odoo', name: 'Odoo', kind: 'erp', status: 'DISABLED' },
      { key: 'samsara', name: 'Samsara', kind: 'telematics', status: 'DISABLED' },
      { key: 'edi-214', name: 'EDI 214', kind: 'edi', status: 'DISABLED' },
    ]);

    expect(roadmap[0]).toMatchObject({ phase: 'foundation', title: 'Système de vérité' });
    expect(roadmap[0].connectors.map((c) => c.key)).toContain('odoo');
    expect(roadmap[1].connectors.map((c) => c.key)).toEqual(['samsara', 'edi-214']);
    expect(roadmap[2].outcome).toContain('automatiser');
  });
});
