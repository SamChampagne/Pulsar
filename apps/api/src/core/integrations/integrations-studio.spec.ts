import { buildConnectionTestReport, buildDryRunMapping } from './integrations.service';

describe('integration studio test and dry-run', () => {
  it('reports connection readiness without exposing secret values', () => {
    const report = buildConnectionTestReport({
      id: 'int_1',
      name: 'Odoo production',
      status: 'DISABLED',
      config: {
        kind: 'erp',
        endpointUrl: 'https://erp.example.com/api',
        apiKey: 'super-secret-key',
        objects: ['Clients', 'Commandes'],
        mappings: [{ source: 'customer.name', target: 'Customer.displayName', transform: 'trim', required: true }],
      },
    });

    expect(report.status).toBe('ok');
    expect(report.checks).toContainEqual(expect.objectContaining({ key: 'endpoint', status: 'ok' }));
    expect(report.checks).toContainEqual(expect.objectContaining({ key: 'credential', status: 'ok' }));
    expect(JSON.stringify(report)).not.toContain('super-secret-key');
  });

  it('blocks connection readiness when endpoint or credentials are missing', () => {
    const report = buildConnectionTestReport({
      id: 'int_2',
      name: 'ERP draft',
      status: 'DISABLED',
      config: { kind: 'erp', mappings: [] },
    });

    expect(report.status).toBe('blocked');
    expect(report.checks).toContainEqual(expect.objectContaining({ key: 'endpoint', status: 'blocked' }));
    expect(report.checks).toContainEqual(expect.objectContaining({ key: 'credential', status: 'blocked' }));
  });

  it('maps nested sample payload fields and flags missing required fields', () => {
    const dryRun = buildDryRunMapping({
      samplePayload: '{"customer":{"name":" Acme "},"order":{"reference":"so-1009"}}',
      mappings: [
        { source: 'customer.name', target: 'Customer.displayName', transform: 'trim', required: true },
        { source: 'order.reference', target: 'TransportOrder.externalRef', transform: 'uppercase', required: true },
        { source: 'order.delivery_date', target: 'TransportOrder.requestedDeliveryAt', transform: 'date.iso', required: true },
      ],
    });

    expect(dryRun.status).toBe('warning');
    expect(dryRun.output).toEqual({
      Customer: { displayName: 'Acme' },
      TransportOrder: { externalRef: 'SO-1009' },
    });
    expect(dryRun.rows).toContainEqual(expect.objectContaining({ source: 'order.delivery_date', status: 'missing' }));
  });
});
