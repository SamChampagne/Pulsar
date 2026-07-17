import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier, OperationalTaskStatus } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

const T = PERMISSIONS.TRANSPORTATION;

/**
 * Dispatch Exception Agent — read-only visibility tools.
 *
 * These wrap the SAME detection/data already produced by the operating workbench
 * (rule 27): late-arriving stops and failed/expired tenders surface as
 * `OperationalTask` rows with category DELAY / TENDER_FAILURE (see
 * @pulsar/shared/operating/policies.ts). No new detection logic lives here — only
 * a governed read over `OperationalTasksService.list`.
 *
 * Retendering a load to a different carrier is deliberately NOT a separate tool:
 * `tender_load` (tms.tools.ts) already tenders any PLANNED load to any carrierId,
 * and a load whose tender was declined/expired is returned to PLANNED by
 * TendersService — so calling `tender_load` again with a new carrierId IS the
 * re-tender action, with the SAME SENSITIVE/ProposedAction/amount-cap gate.
 * Adding a `retender_load` tool would duplicate that path for no new capability.
 */
export const dispatchTools: ToolDef[] = [
  {
    name: 'list_dispatch_exceptions',
    description:
      'List open dispatch exceptions for the tenant: late-arriving stops (category DELAY) ' +
      'and failed/expired tenders (category TENDER_FAILURE) from the operating workbench. ' +
      'Read-only — use check_load_capacity for capacity issues on a specific load, and ' +
      'tender_load to re-tender a load after a TENDER_FAILURE.',
    tier: RiskTier.READ,
    permission: T.PLANNING_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({
      pageSize: z.number().int().positive().max(100).optional(),
    }),
    run: async (args, ctx) => {
      const tenantId = ctx.principal.user.tenantId;
      const pageSize = typeof args.pageSize === 'number' ? args.pageSize : 50;
      const [delays, tenderFailures] = await Promise.all([
        ctx.services.operatingTasks.list(tenantId, {
          status: OperationalTaskStatus.OPEN,
          category: 'DELAY',
          pageSize,
        }),
        ctx.services.operatingTasks.list(tenantId, {
          status: OperationalTaskStatus.OPEN,
          category: 'TENDER_FAILURE',
          pageSize,
        }),
      ]);
      return { delays, tenderFailures };
    },
  },
  {
    name: 'check_load_capacity',
    description:
      "Get a load's current weight/volume/pallet totals (from its assigned shipments) " +
      'versus its assigned trailer limits, with per-axis utilization % and an overCapacity ' +
      'flag. Read-only — mirrors the same capacity check used when assigning resources to a ' +
      'load, without mutating anything.',
    tier: RiskTier.READ,
    permission: T.PLANNING_READ,
    module: MODULE_KEYS.TRANSPORTATION,
    inputSchema: z.object({ loadId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.loads.capacitySummary(ctx.principal.user.tenantId, args.loadId as string),
  },
];
