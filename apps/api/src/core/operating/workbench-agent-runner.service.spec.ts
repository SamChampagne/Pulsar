import { Test } from '@nestjs/testing';
import { OperationalTaskStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentRuntimeService } from '../agents/agent-runtime.service';
import { OperationalTasksService } from './operational-tasks.service';
import { WorkbenchAgentRunner } from './workbench-agent-runner.service';

describe('WorkbenchAgentRunner.tick', () => {
  it('opens a session per agent-assigned OPEN task and closes it, marking IN_PROGRESS', async () => {
    const task = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.OPEN, assigneeAgentId: 'a1', title: 'late', category: 'DELAY', subjectType: 'stop', subjectId: 's1' };
    const opened: any[] = []; const closed: string[] = []; const turns: string[] = [];
    const prisma = {
      agent: { findMany: async () => [{ id: 'a1', tenantId: 'ten1', model: null, persona: null, serviceUserId: 'svc1', caps: { alwaysOn: true } }] },
      operationalTask: {
        findMany: async () => [task],
      },
    } as unknown as PrismaService;
    const runtime = {
      openSession: async (input: any) => { opened.push(input.triggeredByRef); return 'sess1'; },
      sendTurn: async function* () { turns.push('x'); yield { type: 'end' as const }; },
      closeSession: async (s: string) => { closed.push(s); },
    } as unknown as AgentRuntimeService;
    const tasksSvc = {
      start: async (_t: string, _id: string) => { task.status = OperationalTaskStatus.IN_PROGRESS; return task; },
    } as unknown as OperationalTasksService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkbenchAgentRunner,
        { provide: PrismaService, useValue: prisma },
        { provide: AgentRuntimeService, useValue: runtime },
        { provide: OperationalTasksService, useValue: tasksSvc },
      ],
    }).compile();

    const n = await moduleRef.get(WorkbenchAgentRunner).tick('http://localhost:3000/api/v1/mcp', 10);
    expect(n).toBe(1);
    expect(task.status).toBe(OperationalTaskStatus.IN_PROGRESS);
    expect(opened).toEqual(['task:t1']);
    expect(turns).toHaveLength(1);
    expect(closed).toEqual(['sess1']);
  });

  it('reverts the task to OPEN and does not throw when the runtime fails', async () => {
    const task = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.OPEN, assigneeAgentId: 'a1', title: 'late', category: 'DELAY', subjectType: 'stop', subjectId: 's1' };
    const prisma = {
      agent: { findMany: async () => [{ id: 'a1', tenantId: 'ten1', model: null, persona: null, serviceUserId: 'svc1', caps: { alwaysOn: true } }] },
      operationalTask: {
        findMany: async () => [task],
        updateMany: async ({ data }: any) => { Object.assign(task, data); return { count: 1 }; },
      },
    } as unknown as PrismaService;
    const runtime = { openSession: async () => { throw new Error('hermes down'); } } as unknown as AgentRuntimeService;
    const tasksSvc = { start: async () => { task.status = OperationalTaskStatus.IN_PROGRESS; return task; } } as unknown as OperationalTasksService;
    const moduleRef = await Test.createTestingModule({
      providers: [WorkbenchAgentRunner, { provide: PrismaService, useValue: prisma },
        { provide: AgentRuntimeService, useValue: runtime }, { provide: OperationalTasksService, useValue: tasksSvc }],
    }).compile();
    await expect(moduleRef.get(WorkbenchAgentRunner).tick('http://x/mcp', 10)).resolves.toBe(0);
    expect(task.status).toBe(OperationalTaskStatus.OPEN); // reverted
  });

  it('does not reopen a task the agent resolved mid-turn (revert guarded to IN_PROGRESS)', async () => {
    const task = { id: 't1', tenantId: 'ten1', status: OperationalTaskStatus.OPEN, assigneeAgentId: 'a1', title: 'late', category: 'DELAY', subjectType: 'stop', subjectId: 's1' };
    const prisma = {
      agent: { findMany: async () => [{ id: 'a1', tenantId: 'ten1', model: null, persona: null, serviceUserId: 'svc1', caps: { alwaysOn: true } }] },
      operationalTask: {
        findMany: async () => [task],
        // Honor the status guard: only mutate when the where-clause matches the current status.
        updateMany: async ({ where, data }: any) => {
          if (where.status === undefined || task.status === where.status) {
            Object.assign(task, data);
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
    } as unknown as PrismaService;
    const runtime = {
      openSession: async () => 'sess1',
      // Agent resolves the task mid-turn, then the turn throws.
      sendTurn: async function* () {
        yield { type: 'progress' as const };
        task.status = OperationalTaskStatus.RESOLVED;
        throw new Error('hermes died after resolving');
      },
      closeSession: async () => undefined,
    } as unknown as AgentRuntimeService;
    const tasksSvc = { start: async () => { task.status = OperationalTaskStatus.IN_PROGRESS; return task; } } as unknown as OperationalTasksService;
    const moduleRef = await Test.createTestingModule({
      providers: [WorkbenchAgentRunner, { provide: PrismaService, useValue: prisma },
        { provide: AgentRuntimeService, useValue: runtime }, { provide: OperationalTasksService, useValue: tasksSvc }],
    }).compile();
    await expect(moduleRef.get(WorkbenchAgentRunner).tick('http://x/mcp', 10)).resolves.toBe(0);
    expect(task.status).toBe(OperationalTaskStatus.RESOLVED); // not reverted
  });
});
