import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

export const crmTools: ToolDef[] = [
  // ── CRM READ ───────────────────────────────────────────────────────────────
  {
    name: 'crm_list_deals',
    description: 'List CRM deals (optionally by stage or only stale/open).',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CRM.READ,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({ stage: z.string().optional() }),
    run: (args, ctx) =>
      ctx.services.crm.listDeals(ctx.principal.user.tenantId, args),
  },
  {
    name: 'crm_get_company',
    description: 'Get a CRM company with its contacts, deals and recent activities.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CRM.READ,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({ companyId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.crm.getCompany(ctx.principal.user.tenantId, args.companyId as string),
  },
  {
    name: 'crm_list_activities',
    description: 'List activities for a deal or company.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CRM.READ,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({
      dealId: z.string().optional(),
      companyId: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.crm.listActivities(ctx.principal.user.tenantId, args),
  },
  // ── CRM MUTATING ──────────────────────────────────────────────────────────
  {
    name: 'crm_log_activity',
    description:
      'Record a CRM activity (note/call/email/meeting) on a deal/company/contact. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.CRM.MANAGE,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({
      type: z.enum(['NOTE', 'CALL', 'EMAIL', 'MEETING']),
      body: z.string().min(1),
      dealId: z.string().optional(),
      companyId: z.string().optional(),
      contactId: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.crm.logActivity(ctx.principal.user.tenantId, args, {
        agentId: ctx.principal.agentId,
      }),
  },
  {
    name: 'crm_advance_deal',
    description:
      'Advance a deal to a new stage (LEAD/QUALIFIED/PROPOSAL/WON/LOST). PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.CRM.MANAGE,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({
      dealId: z.string().min(1),
      stage: z.enum(['LEAD', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST']),
    }),
    run: (args, ctx) =>
      ctx.services.crm.advanceDeal(
        ctx.principal.user.tenantId,
        args.dealId as string,
        ctx.principal.user.id,
        args.stage as string,
      ),
  },
  {
    name: 'crm_create_followup',
    description:
      'Create a follow-up TASK activity with a due date. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.CRM.MANAGE,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({
      body: z.string().min(1),
      dealId: z.string().optional(),
      companyId: z.string().optional(),
      dueAt: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.crm.createFollowup(ctx.principal.user.tenantId, args, {
        agentId: ctx.principal.agentId,
      }),
  },
];
