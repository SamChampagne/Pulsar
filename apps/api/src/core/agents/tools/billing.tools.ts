import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

export const billingTools: ToolDef[] = [
  // ── Freight audit (billing) ──────────────────────────────────────────────────
  {
    name: 'audit_carrier_invoice',
    description:
      'Run the deterministic match of an incoming carrier invoice against expected load costs. Returns the variance summary and per-line results. Read-only audit (no outward action).',
    tier: RiskTier.READ,
    permission: PERMISSIONS.BILLING.FREIGHT_AUDIT_READ,
    module: MODULE_KEYS.BILLING,
    inputSchema: z.object({ invoiceId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.freightAudit.audit(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.invoiceId as string,
      ),
  },
  {
    name: 'dispute_carrier_invoice',
    description:
      'Open a dispute on a FLAGGED incoming carrier invoice. SENSITIVE — goes through the approval queue.',
    tier: RiskTier.SENSITIVE,
    permission: PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE,
    module: MODULE_KEYS.BILLING,
    inputSchema: z.object({
      invoiceId: z.string().min(1),
      reasonCode: z.string().min(1),
      note: z.string().optional(),
      amount: z.number().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.freightAudit.dispute(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.invoiceId as string,
        { reasonCode: args.reasonCode as string, note: args.note as string | undefined },
        ctx.principal.agentId,
      ),
    amountFrom: (args) => (typeof args.amount === 'number' ? args.amount : undefined),
  },
];
