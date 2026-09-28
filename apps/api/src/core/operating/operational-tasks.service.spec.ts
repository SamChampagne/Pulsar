import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OperationalTaskStatus, TaskAssigneeType } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { OperationalTasksService } from './operational-tasks.service';

function fakePrisma(task: any) {
  return {
    operationalTask: {
      findFirst: async ({ where }: any) =>
        where.tenantId === task.tenantId && where.id === task.id ? task : null,
      updateMany: async ({ where, data }: any) => {
        if (
          where.id === task.id &&
          where.tenantId === task.tenantId &&
          (where.status === undefined || where.status === task.status)
        ) {
          Object.assign(task, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    proposedAction: { findMany: async () => [] },
  } as unknown as PrismaService;
}
const audit = { log: async () => undefined } as unknown as AuditLogsService;

async function build(task: any) {
  const m = await Test.createTestingModule({
    providers: [
      OperationalTasksService,
      { provide: PrismaService, useValue: fakePrisma(task) },
      { provide: AuditLogsService, useValue: audit },
    ],
  }).compile();
  return m.get(OperationalTasksService);
}

describe('OperationalTasksService.resolve', () => {
  it('moves OPEN → RESOLVED and stamps resolver + note', async () => {
    const task: any = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.OPEN };
    const svc = await build(task);
    await svc.resolve('ten1', 't1', 'user1', 'fixed');
    expect(task.status).toBe(OperationalTaskStatus.RESOLVED);
    expect(task.resolvedById).toBe('user1');
    expect(task.resolutionNote).toBe('fixed');
  });

  it('rejects an illegal transition (RESOLVED → RESOLVED)', async () => {
    const task = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.RESOLVED };
    const svc = await build(task);
    await expect(svc.resolve('ten1', 't1', 'user1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not find a task from another tenant', async () => {
    const task = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.OPEN };
    const svc = await build(task);
    await expect(svc.resolve('OTHER', 't1', 'user1')).rejects.toThrow();
  });
});

describe('OperationalTasksService.releaseWorkerClaim', () => {
  it.each([
    [OperationalTaskStatus.IN_PROGRESS, 'ten1', OperationalTaskStatus.OPEN, 1],
    [OperationalTaskStatus.RESOLVED, 'ten1', OperationalTaskStatus.RESOLVED, 0],
    [OperationalTaskStatus.IN_PROGRESS, 'foreign', OperationalTaskStatus.IN_PROGRESS, 0],
  ])(
    'guards status and tenant and audits only a real release (%s, %s)',
    async (status, tenant, expected, count) => {
      const task = { id: 't1', tenantId: 'ten1', status };
      const log = jest.spyOn(audit, 'log');
      log.mockClear();
      const svc = await build(task);
      await svc.releaseWorkerClaim(tenant, 't1', 'service-user');
      expect(task.status).toBe(expected);
      expect(log).toHaveBeenCalledTimes(count);
      if (count)
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: 'ten1',
            userId: 'service-user',
            after: { status: 'OPEN', reason: 'worker_run_not_completed' },
          }),
        );
      log.mockRestore();
    },
  );
});

describe('OperationalTasksService.assign mutual-exclusion', () => {
  it('HUMAN assignee nulls agentId even when both are provided', async () => {
    let writtenData: any = null;
    const task: any = { id: 't2', tenantId: 'ten1', status: OperationalTaskStatus.OPEN };
    const localPrisma = {
      operationalTask: {
        findFirst: async () => task,
        updateMany: async ({ data }: any) => {
          writtenData = data;
          return { count: 1 };
        },
      },
    } as unknown as PrismaService;
    const m = await Test.createTestingModule({
      providers: [
        OperationalTasksService,
        { provide: PrismaService, useValue: localPrisma },
        { provide: AuditLogsService, useValue: audit },
      ],
    }).compile();
    const svc = m.get(OperationalTasksService);

    await svc.assign('ten1', 't2', 'actor1', {
      assigneeType: TaskAssigneeType.HUMAN,
      assigneeUserId: 'user-abc',
      assigneeAgentId: 'agent-xyz',
    });
    expect(writtenData.assigneeUserId).toBe('user-abc');
    expect(writtenData.assigneeAgentId).toBeNull();
  });

  it('AGENT assignee nulls userId even when both are provided', async () => {
    let writtenData: any = null;
    const task: any = { id: 't3', tenantId: 'ten1', status: OperationalTaskStatus.OPEN };
    const localPrisma = {
      operationalTask: {
        findFirst: async () => task,
        updateMany: async ({ data }: any) => {
          writtenData = data;
          return { count: 1 };
        },
      },
    } as unknown as PrismaService;
    const m = await Test.createTestingModule({
      providers: [
        OperationalTasksService,
        { provide: PrismaService, useValue: localPrisma },
        { provide: AuditLogsService, useValue: audit },
      ],
    }).compile();
    const svc = m.get(OperationalTasksService);

    await svc.assign('ten1', 't3', 'actor1', {
      assigneeType: TaskAssigneeType.AGENT,
      assigneeUserId: 'user-abc',
      assigneeAgentId: 'agent-xyz',
    });
    expect(writtenData.assigneeAgentId).toBe('agent-xyz');
    expect(writtenData.assigneeUserId).toBeNull();
  });
});
