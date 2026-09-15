import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@pulsar/shared';
import {
  AgentStatus,
  ProposalStatus,
  deriveIdempotencyKey,
  evaluateAmountCap,
  evaluateRateCap,
  evaluatePolicy,
  effectivePolicies,
  evaluateCircuitBreaker,
  DEFAULT_BREAKER,
  NotificationLevel,
  type PolicyDecision,
  type RiskTier,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AgentPrincipal } from './agent-principal';
import { TOOL_BY_NAME, type ToolServices } from './tool-registry';
import { toolRequiredModules, toolRequiredPermissions } from './tool-types';

@Injectable()
export class ProposedActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
    private readonly modules: TenantModulesCacheService,
  ) {}

  /**
   * Enqueue a mutating/sensitive tool call. Idempotent on (agentId, key); caps re-checked here
   * for direct (base-PROPOSE) callers. When the gate already applied the caps via
   * `evaluatePolicy` (the AUTO→PROPOSE demotion path), pass `capsAlreadyEvaluated` so the rate
   * cap does NOT re-reject the very enqueue the demotion intends — a rate-demoted action must be
   * queued for human review, not lost as an error.
   */
  async enqueue(
    principal: AgentPrincipal,
    tool: string,
    args: Record<string, unknown>,
    opts: { idempotencyKey?: string; triggeredByRef?: string; capsAlreadyEvaluated?: boolean },
  ) {
    const def = TOOL_BY_NAME.get(tool);
    if (!def) throw new BadRequestException(`Unknown tool "${tool}"`);

    const key = opts.idempotencyKey ?? deriveIdempotencyKey(tool, args);
    const existing = await this.prisma.proposedAction.findUnique({
      where: { agentId_idempotencyKey: { agentId: principal.agentId, idempotencyKey: key } },
    });
    if (existing) return this.project(existing);

    // The hard amount cap is ALWAYS enforced here: for a base-PROPOSE agent this is the only
    // enforcement point (evaluatePolicy only checks amount on the AUTO branch). It is never
    // weakened by the demotion path — an action whose amount exceeds the cap is refused, queued
    // or not.
    const amount = def.amountFrom?.(args);
    const amountCap = evaluateAmountCap(amount, principal.caps.maxAmountPerAction);
    if (!amountCap.ok) throw new BadRequestException(amountCap.reason);

    // The rate cap is skipped ONLY on the demotion path: there the gate ALREADY demoted
    // AUTO→PROPOSE *because of* the rate cap, so re-rejecting it here would lose the very action
    // the demotion intends to queue for human review. Direct (base-PROPOSE) callers still get it.
    if (!opts.capsAlreadyEvaluated) {
      const since = new Date(Date.now() - 60_000);
      const recent = await this.prisma.proposedAction.count({
        where: { agentId: principal.agentId, proposedAt: { gte: since } },
      });
      const rateCap = evaluateRateCap(recent, principal.caps.maxActionsPerMinute);
      if (!rateCap.ok) throw new BadRequestException(rateCap.reason);
    }

    const created = await this.prisma.proposedAction.create({
      data: {
        tenantId: principal.user.tenantId,
        agentId: principal.agentId,
        triggeredByRef: opts.triggeredByRef,
        tool,
        argsJson: args as object,
        riskTier: def.tier,
        idempotencyKey: key,
        status: ProposalStatus.PENDING,
      },
    });
    await this.audit.log({
      tenantId: principal.user.tenantId,
      userId: principal.user.id,
      action: AuditAction.CREATE,
      entityType: 'proposed-action',
      entityId: created.id,
      after: { tool, tier: def.tier, agent: principal.name },
    });
    return this.project(created);
  }

  /** Trailing-minute count of recorded actions (auto + proposed) for the agent. */
  private async recentExecutionCount(agentId: string): Promise<number> {
    const since = new Date(Date.now() - 60_000);
    return this.prisma.proposedAction.count({ where: { agentId, proposedAt: { gte: since } } });
  }

  /** True iff the breaker is tripped AND within cooldown. Lazily auto-rearms past cooldown. */
  private async isBreakerTripped(agentId: string): Promise<boolean> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId },
      select: { breakerTrippedAt: true },
    });
    const at = agent?.breakerTrippedAt;
    if (!at) return false;
    if (Date.now() - at.getTime() > DEFAULT_BREAKER.cooldownMs) {
      await this.prisma.agent
        .update({ where: { id: agentId }, data: { breakerTrippedAt: null } })
        .catch(() => undefined);
      return false;
    }
    return true;
  }

  /**
   * The SINGLE autonomy decision for a MUTATING/SENSITIVE tool call. Builds the policy context,
   * evaluates, then: AUTO → run + record EXECUTED/FAILED (autoApproved) + maybe trip breaker;
   * PROPOSE → enqueue PENDING; DENY → return the decision (caller surfaces an error).
   */
  async handleMutatingTool(
    principal: AgentPrincipal,
    def: {
      name: string;
      tier: RiskTier;
      run: (
        a: Record<string, unknown>,
        ctx: { principal: AgentPrincipal; services: ToolServices },
      ) => Promise<unknown>;
      amountFrom?: (a: Record<string, unknown>) => number | undefined;
    },
    args: Record<string, unknown>,
    services: ToolServices,
  ): Promise<PolicyDecision & { proposalId?: string; result?: unknown }> {
    const amount = def.amountFrom?.(args);
    const rules = effectivePolicies(
      principal.caps.policies,
      principal.autonomyLevel,
      principal.caps.autoApprove,
    );
    const decision = evaluatePolicy(rules, {
      tool: def.name,
      tier: def.tier,
      amount,
      recentExecutions: await this.recentExecutionCount(principal.agentId),
      maxPerMinute: principal.caps.maxActionsPerMinute,
      maxAmountPerAction: principal.caps.maxAmountPerAction,
      breakerTripped: await this.isBreakerTripped(principal.agentId),
    });

    if (decision.effect === 'DENY') return decision;
    if (decision.effect === 'PROPOSE') {
      // The gate already applied the caps (DENY above the hard cap; demote above the rule/rate
      // cap). Enqueue without re-checking so a rate-demoted action is queued, not lost (rule 23:
      // the caps live in @pulsar/shared and were evaluated exactly once, here).
      const proposal = await this.enqueue(principal, def.name, args, {
        triggeredByRef: principal.triggeredByRef,
        capsAlreadyEvaluated: true,
      });
      return { ...decision, proposalId: proposal.id };
    }
    // AUTO
    const key = deriveIdempotencyKey(def.name, args);
    try {
      // AUTO — the tool runs before the ledger row is written; recordAutoOutcome dedupes the ROW,
      // not the RUN (one Hermes process per conversation already serializes an agent's calls).
      const result = await def.run(args, { principal, services });
      await this.recordAutoOutcome(principal, def.name, def.tier, args, key, { ok: true, result });
      return { ...decision, result };
    } catch (err) {
      await this.recordAutoOutcome(principal, def.name, def.tier, args, key, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** Persist an auto-executed action as a ProposedAction (EXECUTED|FAILED, autoApproved). Idempotent. */
  private async recordAutoOutcome(
    principal: AgentPrincipal,
    tool: string,
    tier: RiskTier,
    args: Record<string, unknown>,
    key: string,
    outcome: { ok: boolean; result?: unknown; error?: string },
  ): Promise<void> {
    const existing = await this.prisma.proposedAction.findUnique({
      where: { agentId_idempotencyKey: { agentId: principal.agentId, idempotencyKey: key } },
    });
    if (!existing) {
      await this.prisma.proposedAction
        .create({
          data: {
            tenantId: principal.user.tenantId,
            agentId: principal.agentId,
            triggeredByRef: principal.triggeredByRef,
            tool,
            argsJson: args as object,
            riskTier: tier,
            idempotencyKey: key,
            status: outcome.ok ? ProposalStatus.EXECUTED : ProposalStatus.FAILED,
            autoApproved: true,
            resultJson: (outcome.ok ? (outcome.result ?? {}) : { error: outcome.error }) as object,
          },
        })
        .catch(() => undefined); // idempotent: a concurrent same-key insert already recorded it
    }
    await this.maybeTripBreaker(principal);
  }

  /** Read recent outcomes and trip the breaker if the pattern warrants. Best-effort: never throws (rule 24). */
  async maybeTripBreaker(principal: AgentPrincipal): Promise<void> {
    try {
      const agent = await this.prisma.agent.findFirst({
        where: { id: principal.agentId },
        select: { breakerTrippedAt: true },
      });
      if (agent?.breakerTrippedAt) return;
      const rows = await this.prisma.proposedAction.findMany({
        where: {
          agentId: principal.agentId,
          status: { in: [ProposalStatus.EXECUTED, ProposalStatus.FAILED] },
        },
        orderBy: { proposedAt: 'desc' },
        take: DEFAULT_BREAKER.consecutiveFailures,
        select: { status: true, proposedAt: true },
      });
      const recent = rows.map((r) => ({
        failed: r.status === ProposalStatus.FAILED,
        at: r.proposedAt.getTime(),
      }));
      if (!evaluateCircuitBreaker(recent, DEFAULT_BREAKER)) return;
      await this.prisma.agent
        .update({ where: { id: principal.agentId }, data: { breakerTrippedAt: new Date() } })
        .catch(() => undefined);
      await this.audit.log({
        tenantId: principal.user.tenantId,
        userId: principal.user.id,
        action: AuditAction.UPDATE,
        entityType: 'agent',
        entityId: principal.agentId,
        after: { breakerTripped: true, reason: 'consecutive failures' },
      });
      await this.notifications
        .notify({
          tenantId: principal.user.tenantId,
          title: `Agent ${principal.name} — circuit breaker`,
          body: `L'agent a été rétrogradé en PROPOSE après ${DEFAULT_BREAKER.consecutiveFailures} échecs consécutifs.`,
          level: NotificationLevel.WARNING,
        })
        .catch(() => undefined);
    } catch {
      // Circuit-breaker bookkeeping is best-effort and must never break a committed action (rule 24).
    }
  }

  async listPending(tenantId: string) {
    // Bound the queue read: an AUTONOMOUS-heavy tenant could otherwise accumulate
    // thousands of PENDING rows and return them all in one unbounded query. 200 is
    // far beyond a realistic human-review backlog (oldest first, so nothing actionable
    // is hidden); revisit with real pagination if a tenant ever legitimately exceeds it.
    const rows = await this.prisma.proposedAction.findMany({
      where: { tenantId, status: ProposalStatus.PENDING },
      orderBy: { proposedAt: 'asc' },
      take: 200,
    });
    return rows.map((r) => this.project(r));
  }

  /** Approve + execute. Re-checks status (race-safe) then runs the tool's real handler. */
  async approve(tenantId: string, id: string, approverId: string, services: ToolServices) {
    const proposal = await this.prisma.proposedAction.findFirst({ where: { id, tenantId } });
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new BadRequestException(`Proposal is ${proposal.status}, not PENDING`);
    }
    const def = TOOL_BY_NAME.get(proposal.tool);
    if (!def) throw new BadRequestException(`Unknown tool "${proposal.tool}"`);

    // The agent must still be ACTIVE: if a human PAUSED (kill switch, rule 28) or
    // REVOKED it between enqueue and approval, its queued actions must not execute.
    const agent = await this.prisma.agent.findFirstOrThrow({
      where: { id: proposal.agentId, tenantId },
    });
    if (agent.status !== AgentStatus.ACTIVE) {
      throw new BadRequestException(`Agent is ${agent.status}, cannot approve its actions`);
    }

    // Approval must not bypass the tool's authorization: the agent must STILL hold
    // every required permission and the tenant STILL have every required module
    // enabled (a demotion or a module toggle between enqueue and approval must
    // block execution). Same requirements the MCP exposure gate enforced.
    const grantedPerms = new Set(agent.permissions as string[]);
    const currentCaps = (agent.caps ?? {}) as AgentPrincipal['caps'];
    if (currentCaps.toolAllowlist && !currentCaps.toolAllowlist.includes(def.name)) throw new BadRequestException('Tool no longer allowed for this agent');
    const missingPerm = toolRequiredPermissions(def).find((p) => !grantedPerms.has(p));
    if (missingPerm) {
      throw new BadRequestException(
        `Agent no longer holds required permission "${missingPerm}" for tool "${def.name}"`,
      );
    }
    const requiredModules = toolRequiredModules(def);
    if (requiredModules.length > 0) {
      const enabled = await this.modules.getEnabledKeys(tenantId).catch(() => new Set<string>());
      const missingModule = requiredModules.find((m) => !enabled.has(m));
      if (missingModule) {
        throw new BadRequestException(
          `Module "${missingModule}" is not enabled; cannot approve tool "${def.name}"`,
        );
      }
    }

    // Race-safe claim: only one approver moves PENDING -> APPROVED (tenant-scoped).
    const claimed = await this.prisma.proposedAction.updateMany({
      where: { id, tenantId, status: ProposalStatus.PENDING },
      data: { status: ProposalStatus.APPROVED, decidedById: approverId, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw new BadRequestException('Proposal already decided');
    const principal: AgentPrincipal = {
      agentId: agent.id,
      name: agent.name,
      caps: (agent.caps ?? {}) as AgentPrincipal['caps'],
      user: {
        id: agent.serviceUserId,
        tenantId: agent.tenantId,
        email: `agent:${agent.name}`,
        firstName: 'Agent',
        lastName: agent.name,
        permissions: agent.permissions as AgentPrincipal['user']['permissions'],
      },
      autonomyLevel: agent.autonomyLevel as AgentPrincipal['autonomyLevel'],
      triggeredByRef: proposal.triggeredByRef ?? undefined,
    };

    try {
      const result = await def.run(proposal.argsJson as Record<string, unknown>, {
        principal,
        services,
      });
      const done = await this.prisma.proposedAction.update({
        where: { id },
        data: { status: ProposalStatus.EXECUTED, resultJson: (result ?? {}) as object },
      });
      await this.audit.log({
        tenantId,
        userId: principal.user.id,
        action: AuditAction.UPDATE,
        entityType: 'proposed-action',
        entityId: id,
        after: { status: 'EXECUTED', tool: proposal.tool, approvedBy: approverId },
      });
      await this.maybeTripBreaker(principal);
      return this.project(done);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : 'Error';
      const failed = await this.prisma.proposedAction.update({
        where: { id },
        data: { status: ProposalStatus.FAILED, resultJson: { error: message, name } },
      });
      await this.audit.log({
        tenantId,
        userId: principal.user.id,
        action: AuditAction.UPDATE,
        entityType: 'proposed-action',
        entityId: id,
        after: { status: 'FAILED', tool: proposal.tool, approvedBy: approverId, error: message },
      });
      await this.maybeTripBreaker(principal);
      return this.project(failed);
    }
  }

  async reject(tenantId: string, id: string, approverId: string) {
    const claimed = await this.prisma.proposedAction.updateMany({
      where: { id, tenantId, status: ProposalStatus.PENDING },
      data: { status: ProposalStatus.REJECTED, decidedById: approverId, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw new BadRequestException('Proposal not pending');
    await this.audit.log({
      tenantId,
      userId: approverId,
      action: AuditAction.UPDATE,
      entityType: 'proposed-action',
      entityId: id,
      after: { status: 'REJECTED' },
    });
    return { rejected: true };
  }

  private project(p: {
    id: string;
    tool: string;
    riskTier: string;
    status: string;
    argsJson: unknown;
    proposedAt: Date;
    resultJson: unknown;
    triggeredByRef: string | null;
  }) {
    return {
      id: p.id,
      tool: p.tool,
      riskTier: p.riskTier,
      status: p.status,
      args: p.argsJson,
      triggeredByRef: p.triggeredByRef,
      proposedAt: p.proposedAt,
      result: p.resultJson,
    };
  }
}
