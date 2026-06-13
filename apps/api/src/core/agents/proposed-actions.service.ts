import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@pulsar/shared';
import {
  ProposalStatus,
  deriveIdempotencyKey,
  evaluateAmountCap,
  evaluateRateCap,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AgentPrincipal } from './agent-principal';
import { TOOL_BY_NAME, type ToolServices } from './tool-registry';

@Injectable()
export class ProposedActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
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
