import { Test } from '@nestjs/testing';
import { DomainEventStatus, OperationalTaskStatus } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SequencesService } from '../../prisma/sequences.service';
import { AgentWorkerService } from './agent-worker.service';
import { DomainEventsService } from './domain-events.service';
import { TaskAssignmentResolver } from './event-policies';
import { CustomRuleResolver } from '../automation/custom-rule.resolver';
import { ReactionExecutorService } from '../automation/reaction-executor.service';

// Phase 13: DomainEventsService wakes the always-on worker on task creation.
// Unit tests stub it out — worker behaviour is covered by agent-worker.service.spec.ts.
const workerStub = { enqueueTask: () => undefined } as unknown as AgentWorkerService;
// SequencesService is best-effort in processPending; stub a number generator.
const sequencesStub = { nextNumber: async () => 'EX-0001' } as unknown as SequencesService;
// Module I: tenant automation rules layer — stub to no extra specs in these unit tests.
const customRuleResolverStub = { resolve: async () => ({ taskSpecs: [], reactionCommands: [] }) } as unknown as CustomRuleResolver;
// ReactionExecutorService: stub for DI (execution tested separately).
const reactionExecutorStub = { executeCommand: async () => undefined } as unknown as ReactionExecutorService;

// Minimal in-memory prisma fake.
function makePrismaFake() {
  const events: any[] = [];
  const tasks: any[] = [];
  let seq = 0;
  return {
    _events: events,
    _tasks: tasks,
    domainEvent: {
      create: async ({ data }: any) => { const e = { id: `e${++seq}`, attempts: 0, ...data }; events.push(e); return e; },
      findMany: async () => events.filter((e) => e.status === 'PENDING'),
      updateMany: async ({ where, data }: any) => {
        let n = 0;
        for (const e of events) {
          if (e.id === where.id && (where.status === undefined || e.status === where.status)) {
            if (data.attempts && typeof data.attempts === 'object') { e.attempts = (e.attempts ?? 0) + 1; }
            if (data.status) e.status = data.status;
            if ('lastError' in data) e.lastError = data.lastError;
            n++;
          }
        }
        return { count: n };
      },
    },
    operationalTask: {
      create: async ({ data }: any) => {
        if (tasks.some((t) => t.tenantId === data.tenantId && t.dedupKey === data.dedupKey)) {
          const err: any = new Error('unique'); err.code = 'P2002'; throw err;
        }
        const t = { id: `t${++seq}`, ...data }; tasks.push(t); return t;
      },
    },
    agent: { findMany: async () => [] },
  } as unknown as PrismaService;
}

describe('DomainEventsService', () => {
  it('emit persists a PENDING event; processPending creates an UNASSIGNED task and marks PROCESSED', async () => {
    const prisma = makePrismaFake();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DomainEventsService,
        TaskAssignmentResolver,
        { provide: PrismaService, useValue: prisma },
        { provide: AgentWorkerService, useValue: workerStub },
        { provide: SequencesService, useValue: sequencesStub },
        { provide: CustomRuleResolver, useValue: customRuleResolverStub },
        { provide: ReactionExecutorService, useValue: reactionExecutorStub },
      ],
    }).compile();
    const svc = moduleRef.get(DomainEventsService);

    await svc.emit('tenant1', 'stop.delayed', { type: 'stop', id: 's1' }, {
      stopId: 's1', loadId: 'l1', deadline: '2026-06-14T12:00:00.000Z', minutesLate: 30,
    });
    expect((prisma as any)._events).toHaveLength(1);
    expect((prisma as any)._events[0].status).toBe(DomainEventStatus.PENDING);

    const processed = await svc.processPending(50);
    expect(processed).toBe(1);
    expect((prisma as any)._tasks).toHaveLength(1);
    expect((prisma as any)._tasks[0].status).toBe(OperationalTaskStatus.OPEN);
    expect((prisma as any)._tasks[0].assigneeType).toBe('UNASSIGNED');
    expect((prisma as any)._events[0].status).toBe(DomainEventStatus.PROCESSED);
  });

  it('emit never throws even if create fails (best-effort)', async () => {
    const prisma = makePrismaFake();
    (prisma as any).domainEvent.create = async () => { throw new Error('db down'); };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DomainEventsService,
        TaskAssignmentResolver,
        { provide: PrismaService, useValue: prisma },
        { provide: AgentWorkerService, useValue: workerStub },
        { provide: SequencesService, useValue: sequencesStub },
        { provide: CustomRuleResolver, useValue: customRuleResolverStub },
        { provide: ReactionExecutorService, useValue: reactionExecutorStub },
      ],
    }).compile();
    await expect(moduleRef.get(DomainEventsService).emit('t', 'stop.delayed', null, {})).resolves.toBeUndefined();
  });

  it('marks the event FAILED when task creation throws a non-P2002 error', async () => {
    const prisma = makePrismaFake();
    (prisma as any).operationalTask.create = async () => { throw new Error('boom'); };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DomainEventsService,
        TaskAssignmentResolver,
        { provide: PrismaService, useValue: prisma },
        { provide: AgentWorkerService, useValue: workerStub },
        { provide: SequencesService, useValue: sequencesStub },
        { provide: CustomRuleResolver, useValue: customRuleResolverStub },
        { provide: ReactionExecutorService, useValue: reactionExecutorStub },
      ],
    }).compile();
    const svc = moduleRef.get(DomainEventsService);
    await svc.emit('tenant1', 'stop.delayed', { type: 'stop', id: 's1' }, {
      stopId: 's1', loadId: 'l1', deadline: '2026-06-14T12:00:00.000Z', minutesLate: 30,
    });
    const handled = await svc.processPending(50);
    expect(handled).toBe(0);
    expect((prisma as any)._events[0].status).toBe('FAILED');
    expect((prisma as any)._events[0].lastError).toContain('boom');
    expect((prisma as any)._tasks).toHaveLength(0);
  });
});
