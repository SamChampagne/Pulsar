import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

export const billingTools: ToolDef[] = [
  // ── General ledger ───────────────────────────────────────────────────────────
  {
    name: 'get_trial_balance',
    description:
      "Returns the tenant's trial balance (sum of debits and credits per account). Optional asOf date (ISO string) to filter entries up to that date. The totals should always balance (total debit === total credit) for a healthy ledger.",
    tier: RiskTier.READ,
    permission: PERMISSIONS.BILLING.LEDGER_READ,
    module: MODULE_KEYS.BILLING,
    inputSchema: z.object({ asOf: z.string().optional() }),
    run: (args, ctx) =>
      ctx.services.ledger.trialBalance(
        ctx.principal.user.tenantId,
        args.asOf ? new Date(args.asOf as string) : undefined,
      ),
  },
  {
    name: 'list_journal_entries',
    description:
      'Returns a paginated list of journal entries (with their lines and account codes). Optional accountId filter to see only entries touching a specific account.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.BILLING.LEDGER_READ,
    module: MODULE_KEYS.BILLING,
    inputSchema: z.object({
      accountId: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    }),
    run: (args, ctx) =>
      ctx.services.ledger.listJournal(ctx.principal.user.tenantId, {
        accountId: args.accountId as string | undefined,
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      }),
  },
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
