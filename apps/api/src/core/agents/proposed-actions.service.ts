import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@pulsar/shared';
import {
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
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AgentPrincipal } from './agent-principal';
import { TOOL_BY_NAME, type ToolServices } from './tool-registry';

@Injectable()
export class ProposedActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Enqueue a mutating/sensitive tool call. Idempotent on (agentId, key); caps re-checked here.
   * Returns the (possibly pre-existing) proposal projection.
   */
  async enqueue(
    principal: AgentPrincipal,
    tool: string,
    args: Record<string, unknown>,
    opts: { idempotencyKey?: string; triggeredByRef?: string },
  ) {
    const def = TOOL_BY_NAME.get(tool);
    if (!def) throw new BadRequestException(`Unknown tool "${tool}"`);

    const key = opts.idempotencyKey ?? deriveIdempotencyKey(tool, args);
    const existing = await this.prisma.proposedAction.findUnique({
      where: { agentId_idempotencyKey: { agentId: principal.agentId, idempotencyKey: key } },
    });
    if (existing) return this.project(existing);

    // Caps (amount + rate) before creating the proposal.
    const amount = def.amountFrom?.(args);
    const amountCap = evaluateAmountCap(amount, principal.caps.maxAmountPerAction);
    if (!amountCap.ok) throw new BadRequestException(amountCap.reason);

    const since = new Date(Date.now() - 60_000);
    const recent = await this.prisma.proposedAction.count({
      where: { agentId: principal.agentId, proposedAt: { gte: since } },
    });
    const rateCap = evaluateRateCap(recent, principal.caps.maxActionsPerMinute);
    if (!rateCap.ok) throw new BadRequestException(rateCap.reason);

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
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId }, select: { breakerTrippedAt: true } });
    const at = agent?.breakerTrippedAt;
    if (!at) return false;
    if (Date.now() - at.getTime() > DEFAULT_BREAKER.cooldownMs) {
      await this.prisma.agent.update({ where: { id: agentId }, data: { breakerTrippedAt: null } }).catch(() => undefined);
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
      run: (a: Record<string, unknown>, ctx: { principal: AgentPrincipal; services: ToolServices }) => Promise<unknown>;
      amountFrom?: (a: Record<string, unknown>) => number | undefined;
    },
    args: Record<string, unknown>,
    services: ToolServices,
  ): Promise<PolicyDecision & { proposalId?: string; result?: unknown }> {
    const amount = def.amountFrom?.(args);
    const rules = effectivePolicies(principal.caps.policies, principal.autonomyLevel, principal.caps.autoApprove);
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
      const proposal = await this.enqueue(principal, def.name, args, { triggeredByRef: principal.triggeredByRef });
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
      await this.recordAutoOutcome(principal, def.name, def.tier, args, key, { ok: false, error: err instanceof Error ? err.message : String(err) });
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
            resultJson: (outcome.ok ? outcome.result ?? {} : { error: outcome.error }) as object,
          },
        })
        .catch(() => undefined); // idempotent: a concurrent same-key insert already recorded it
    }
    await this.maybeTripBreaker(principal);
  }

  /** Read recent outcomes and trip the breaker if the pattern warrants. Best-effort: never throws (rule 24). */
  async maybeTripBreaker(principal: AgentPrincipal): Promise<void> {
    try {
      const agent = await this.prisma.agent.findFirst({ where: { id: principal.agentId }, select: { breakerTrippedAt: true } });
      if (agent?.breakerTrippedAt) return;
      const rows = await this.prisma.proposedAction.findMany({
        where: { agentId: principal.agentId, status: { in: [ProposalStatus.EXECUTED, ProposalStatus.FAILED] } },
        orderBy: { proposedAt: 'desc' },
        take: DEFAULT_BREAKER.consecutiveFailures,
        select: { status: true, proposedAt: true },
      });
      const recent = rows.map((r) => ({ failed: r.status === ProposalStatus.FAILED, at: r.proposedAt.getTime() }));
      if (!evaluateCircuitBreaker(recent, DEFAULT_BREAKER)) return;
      await this.prisma.agent.update({ where: { id: principal.agentId }, data: { breakerTrippedAt: new Date() } }).catch(() => undefined);
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
    const rows = await this.prisma.proposedAction.findMany({
      where: { tenantId, status: ProposalStatus.PENDING },
      orderBy: { proposedAt: 'asc' },
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

    // Race-safe claim: only one approver moves PENDING -> APPROVED.
    const claimed = await this.prisma.proposedAction.updateMany({
      where: { id, status: ProposalStatus.PENDING },
      data: { status: ProposalStatus.APPROVED, decidedById: approverId, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw new BadRequestException('Proposal already decided');

    const agent = await this.prisma.agent.findUniqueOrThrow({ where: { id: proposal.agentId } });
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
