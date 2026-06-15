import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_PROVIDER_BLUEPRINTS,
  buildConnectorOnboardingSteps,
  canAgentUseIntegrationCapability,
  getConnectorProviderBlueprint,
  requiresApprovalForCapability,
  summarizeConnectorFoundation,
  type ConnectorOnboardingStep,
  type IntegrationAgentAccessContext,
} from './connector-foundation';

describe('integration connector foundation', () => {
  it('ships provider blueprints for ERP, accounting, warehouse, API, webhook and CSV onboarding', () => {
    const keys = CONNECTOR_PROVIDER_BLUEPRINTS.map((blueprint) => blueprint.key);

    expect(keys).toEqual(expect.arrayContaining(['odoo', 'quickbooks', 'warehouse-wms', 'custom-api', 'webhook', 'csv-import']));
    expect(getConnectorProviderBlueprint('odoo')?.defaultCapabilities).toEqual(
      expect.arrayContaining(['customers.read', 'orders.read', 'invoices.read']),
    );
    expect(getConnectorProviderBlueprint('warehouse-wms')?.defaultCapabilities).toEqual(
      expect.arrayContaining(['inventory.read', 'receiving.read', 'picking.read']),
    );
    expect(getConnectorProviderBlueprint('warehouse-wms')?.defaultCapabilities).not.toContain('picking.write');
    expect(getConnectorProviderBlueprint('warehouse-wms')?.supportedCapabilities).toContain('picking.write');
  });

  it('classifies capabilities that write external systems as approval-required by default', () => {
    expect(requiresApprovalForCapability('customers.read')).toBe(false);
    expect(requiresApprovalForCapability('webhooks.receive')).toBe(false);
    expect(requiresApprovalForCapability('orders.write')).toBe(true);
    expect(requiresApprovalForCapability('picking.write')).toBe(true);
    expect(requiresApprovalForCapability('invoices.write')).toBe(true);
  });

  it('blocks agent access when connector is disabled, unhealthy, missing capability or policy approval', () => {
    const base: IntegrationAgentAccessContext = {
      connectorStatus: 'ENABLED',
      healthState: 'live',
      requestedCapability: 'orders.write',
      connectorCapabilities: ['orders.read', 'orders.write'],
      agentAllowedCapabilities: ['orders.read', 'orders.write'],
      approvalPolicy: 'propose',
    };

    expect(canAgentUseIntegrationCapability(base)).toMatchObject({ allowed: false, reason: 'approval_required' });
    expect(canAgentUseIntegrationCapability({ ...base, approvalPolicy: 'auto_low_risk' })).toMatchObject({
      allowed: false,
      reason: 'approval_required',
    });
    expect(canAgentUseIntegrationCapability({ ...base, requestedCapability: 'orders.read' })).toMatchObject({
      allowed: true,
      reason: 'allowed',
    });
    expect(
      canAgentUseIntegrationCapability({
        ...base,
        requestedCapability: 'shipments.write',
        connectorCapabilities: ['shipments.write'],
        agentAllowedCapabilities: ['shipments.write'],
        approvalPolicy: 'propose',
      }),
    ).toMatchObject({ allowed: false, reason: 'approval_required', approvalRequired: true });
    expect(canAgentUseIntegrationCapability({ ...base, connectorStatus: 'DISABLED' })).toMatchObject({
      allowed: false,
      reason: 'connector_not_live',
    });
    expect(canAgentUseIntegrationCapability({ ...base, requestedCapability: 'inventory.read' })).toMatchObject({
      allowed: false,
      reason: 'capability_missing',
    });
  });

  it('summarizes connector foundation readiness without needing database schema changes', () => {
    const summary = summarizeConnectorFoundation({
      providerKey: 'quickbooks',
      enabledCapabilities: ['customers.read', 'invoices.read'],
      mappedCapabilities: ['customers.read'],
      testedCapabilities: ['customers.read'],
      owner: 'finance',
    });

    expect(summary.provider?.key).toBe('quickbooks');
    expect(summary.stage).toBe('mapping');
    expect(summary.missingMapping).toEqual(expect.arrayContaining(['invoices.read', 'payments.read']));
    expect(summary.nextAction).toContain('mapping');
  });

  it('builds client-facing onboarding steps in the safe order: auth, scopes, mapping, sandbox, activation', () => {
    const steps: ConnectorOnboardingStep[] = buildConnectorOnboardingSteps('custom-api');

    expect(steps.map((step) => step.key)).toEqual([
      'select-provider',
      'authenticate',
      'choose-capabilities',
      'map-fields',
      'run-sandbox-test',
      'activate-with-monitoring',
    ]);
    expect(steps.find((step) => step.key === 'run-sandbox-test')?.evidenceRequired).toBe(true);
    expect(steps.find((step) => step.key === 'activate-with-monitoring')?.agentGate).toContain('ProposedAction');
  });
});
