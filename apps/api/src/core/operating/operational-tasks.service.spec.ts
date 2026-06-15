import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OperationalTaskStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { OperationalTasksService } from './operational-tasks.service';

function fakePrisma(task: any) {
  return {
    operationalTask: {
      findFirst: async ({ where }: any) => (where.tenantId === task.tenantId && where.id === task.id ? task : null),
      updateMany: async ({ where, data }: any) => {
        if (where.id === task.id && where.tenantId === task.tenantId && (where.status === undefined || where.status === task.status)) {
          Object.assign(task, data); return { count: 1 };
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
