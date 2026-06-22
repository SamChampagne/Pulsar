import { z } from 'zod';
import { PERMISSIONS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

export const coreTools: ToolDef[] = [
  // ── Core workbench tools (no module requirement — always available) ──────────
  {
    name: 'list_my_tasks',
    description: 'List open and in-progress operating tasks assigned to this agent.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_READ,
    inputSchema: z.object({}),
    run: (_args, ctx) =>
      ctx.services.operatingTasks.listForAgent(
        ctx.principal.user.tenantId,
        ctx.principal.agentId,
      ),
  },
  {
    name: 'get_task',
    description: 'Get a single operating task by id, including linked proposed actions.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_READ,
    inputSchema: z.object({ taskId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.operatingTasks.getForTenant(
        ctx.principal.user.tenantId,
        args.taskId as string,
      ),
  },
  {
    name: 'resolve_task',
    description: 'Resolve an operating task assigned to me, with an optional note. Runs immediately (low-risk self-management).',
    tier: RiskTier.LOW,
    permission: PERMISSIONS.CORE.OPERATING_TASKS_MANAGE,
    inputSchema: z.object({ taskId: z.string().min(1), note: z.string().optional() }),
    run: (args, ctx) =>
      ctx.services.operatingTasks.resolve(
        ctx.principal.user.tenantId,
        args.taskId as string,
        ctx.principal.user.id,
        args.note as string | undefined,
      ),
  },
];
