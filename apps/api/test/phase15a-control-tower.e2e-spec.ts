/**
 * E2E phase 15a — KPIs, control-tower rollup, and the unified activity timeline.
 *
 * These three read-only endpoints aggregate ON READ from ProposedAction, AgentRun,
 * OperationalTask and AuditLog. This suite SEEDS deterministic fixture rows directly
 * via prisma (no reliance on the eager worker / a real Hermes turn) and reads them
 * back through the HTTP endpoints with the admin Bearer token.
 *
 *   1. kpis          → GET /agents/:id/kpis aggregates actions/runs/tasks/breaker.
 *   2. control-tower → GET /agents/control-tower lists per-agent KPIs + a rollup.
 *   3. timeline      → GET /agents/:id/timeline merges runs/actions/lifecycle, desc.
 *   4. projection    → secretHash / serviceUserId never leak (rule 26).
 *   5. isolation     → control-tower is the acme tenant only (seeded agent present).
 *
 * LOAD-BEARING ASSERTION: breakerTrips >= 1 in scenario 1 is the FIRST real-Postgres
 * exercise of the Prisma JSON filter
 *   auditLog.count({ where: { ..., after: { path: ['breakerTripped'], equals: true } } }).
 * We seed exactly one such AuditLog row; if the count returns 0, the JSON filter does
 * not work against this Postgres/Prisma version (report DONE_WITH_CONCERNS).
 *
 * The bootstrap (app build / login / tenantId / PrismaService handle / afterAll cleanup)
 * is copied from phase14-autonomy.e2e-spec.ts; like phase-14 it overrides
 * AgentRuntimeService with a fake so the app boots without a real Hermes process.
 *
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as net from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentsService } from '../src/core/agents/agents.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

const PLANNING_PERMS = ['transportation.planning.read', 'transportation.planning.manage'];

// ---------------------------------------------------------------------------
// FakeAgentRuntimeService — minimal stub. This suite drives prisma + the read
// endpoints directly, so the runtime is never used; the override only keeps the
// app bootable without a real Hermes dependency (mirrors phase-14 intent).
// ---------------------------------------------------------------------------
@Injectable()
class FakeAgentRuntimeService {
  constructor(private readonly _agents: AgentsService) {}
  async openSession(): Promise<string> {
    return 'fake-session';
  }
  async *sendTurn(): AsyncGenerator<never> {
    /* no turns driven in this suite */
  }
  async closeSession(): Promise<void> {
    /* no-op */
  }
  async killAgentSessions(): Promise<void> {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Phase 15a — KPIs / control-tower / timeline (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let token = '';
  let tenantId = '';
  let agentId = '';

  const suffix = `${Date.now()}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentRuntimeService)
      .useClass(FakeAgentRuntimeService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );

    await app.listen(0);
    http = app.getHttpServer();
    void (http.address() as net.AddressInfo).port;

    prisma = app.get(PrismaService);

    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // --- Register the agent under test via the real endpoint. ---------------
    const reg = await request(http)
      .post('/api/v1/agents')
      .set(auth())
      .send({
        name: `p15a-ct-${suffix}`,
        persona: 'Control-tower KPI fixture agent for phase-15a e2e.',
        role: 'dispatcher',
        model: 'anthropic:claude-sonnet-4-6',
        autonomyLevel: 'PROPOSE',
        permissions: PLANNING_PERMS,
        caps: {},
      })
      .expect(201);
    agentId = (reg.body as { id: string }).id;

    const now = Date.now();

    // --- Seed ProposedAction ×4 (EXECUTED auto, EXECUTED manual, REJECTED, FAILED). ---
    await prisma.proposedAction.createMany({
      data: [
        {
          tenantId,
          agentId,
          tool: 'create_load',
          argsJson: { notes: `auto-${suffix}` },
          riskTier: 'MUTATING',
          status: 'EXECUTED',
          autoApproved: true,
          idempotencyKey: `p15a-exec-auto-${suffix}`,
          proposedAt: new Date(now),
        },
        {
          tenantId,
          agentId,
          tool: 'create_load',
          argsJson: { notes: `manual-${suffix}` },
          riskTier: 'MUTATING',
          status: 'EXECUTED',
          autoApproved: false,
          idempotencyKey: `p15a-exec-manual-${suffix}`,
          proposedAt: new Date(now),
        },
        {
          tenantId,
          agentId,
          tool: 'tender_load',
          argsJson: { amount: 1234 },
          riskTier: 'SENSITIVE',
          status: 'REJECTED',
          autoApproved: false,
          idempotencyKey: `p15a-rejected-${suffix}`,
          proposedAt: new Date(now),
        },
        {
          tenantId,
          agentId,
          tool: 'assign_shipment',
          argsJson: { shipmentId: 'x', loadId: 'y' },
          riskTier: 'MUTATING',
          status: 'FAILED',
          autoApproved: true,
          idempotencyKey: `p15a-failed-${suffix}`,
          proposedAt: new Date(now),
        },
      ],
    });

    // --- Seed AgentRun ×2 (SUCCEEDED 200ms latency, FAILED). ----------------
    await prisma.agentRun.createMany({
      data: [
        {
          tenantId,
          agentId,
          trigger: 'CRON',
          status: 'SUCCEEDED',
          attempt: 1,
          startedAt: new Date(now),
          finishedAt: new Date(now + 200),
          createdAt: new Date(now),
        },
        {
          tenantId,
          agentId,
          trigger: 'CRON',
          status: 'FAILED',
          attempt: 1,
          startedAt: new Date(now),
          finishedAt: new Date(now + 50),
          createdAt: new Date(now),
        },
      ],
    });

    // --- Seed OperationalTask ×1 (RESOLVED, assigned to the agent). ---------
    await prisma.operationalTask.create({
      data: {
        tenantId,
        type: 'EXCEPTION',
        category: 'p15a-test',
        status: 'RESOLVED',
        severity: 'WARNING',
        title: `p15a resolved task ${suffix}`,
        subjectType: 'load',
        subjectId: `load-${suffix}`,
        assigneeType: 'AGENT',
        assigneeAgentId: agentId,
        dedupKey: `p15a-task-${suffix}`,
        resolvedAt: new Date(now),
      },
    });

    // --- Seed AuditLog ×1: the breaker-trip lifecycle row (JSON-filter target). ---
    await prisma.auditLog.create({
      data: {
        tenantId,
        entityType: 'agent',
        entityId: agentId,
        action: 'UPDATE',
        after: { breakerTripped: true, reason: 'test' },
      },
    });
  });

  afterAll(async () => {
    if (prisma && agentId) {
      await prisma.auditLog
        .deleteMany({ where: { tenantId, entityType: 'agent', entityId: agentId } })
        .catch(() => undefined);
      await prisma.operationalTask
        .deleteMany({ where: { tenantId, assigneeAgentId: agentId } })
        .catch(() => undefined);
      await prisma.agentRun.deleteMany({ where: { agentId } }).catch(() => undefined);
      await prisma.proposedAction.deleteMany({ where: { agentId } }).catch(() => undefined);

      const agentRow = await prisma.agent
        .findUnique({ where: { id: agentId }, select: { serviceUserId: true } })
        .catch(() => null);
      await prisma.agent.deleteMany({ where: { id: agentId } }).catch(() => undefined);
      if (agentRow?.serviceUserId) {
        await prisma.user
          .deleteMany({ where: { id: agentRow.serviceUserId } })
          .catch(() => undefined);
      }
    }
    await app.close();
  });

  // =========================================================================
  // Scenario 1 — kpis
  // =========================================================================
  describe('Scenario 1 — kpis', () => {
    it('aggregates actions/runs/tasks/breaker; the JSON breaker filter returns >= 1', async () => {
      const res = await request(http)
        .get(`/api/v1/agents/${agentId}/kpis`)
        .set(auth())
        .expect(200);

      const body = res.body as {
        actions: { total: number; executed: number; rejected: number; failed: number };
        breakerTrips: number;
        tasksResolved: number;
        avgRunLatencyMs: number;
        approvalRate: number;
        errorRate: number;
      };

      expect(body.actions.executed).toBeGreaterThanOrEqual(2);
      expect(body.actions.rejected).toBeGreaterThanOrEqual(1);
      expect(body.actions.failed).toBeGreaterThanOrEqual(1);
      expect(body.actions.total).toBeGreaterThanOrEqual(4);

      // LOAD-BEARING: validates the Prisma Postgres JSON path filter for real.
      expect(body.breakerTrips).toBeGreaterThanOrEqual(1);

      expect(body.tasksResolved).toBeGreaterThanOrEqual(1);
      expect(typeof body.avgRunLatencyMs).toBe('number');
      expect(body.approvalRate).toBeGreaterThanOrEqual(0);
      expect(body.approvalRate).toBeLessThanOrEqual(1);
      expect(body.errorRate).toBeGreaterThanOrEqual(0);
      expect(body.errorRate).toBeLessThanOrEqual(1);
    });
  });

  // =========================================================================
  // Scenario 2 — control-tower
  // =========================================================================
  describe('Scenario 2 — control-tower', () => {
    it('lists per-agent KPIs and an aggregate rollup', async () => {
      const res = await request(http)
        .get('/api/v1/agents/control-tower')
        .set(auth())
        .expect(200);

      const body = res.body as {
        items: Array<{ id: string; kpis: unknown }>;
        rollup: { agents: number; totalBreakerTrips: number; pendingApprovals: number };
      };

      expect(Array.isArray(body.items)).toBe(true);
      const mine = body.items.find((i) => i.id === agentId);
      expect(mine).toBeTruthy();
      expect(mine!.kpis).toBeTruthy();

      expect(body.rollup.agents).toBeGreaterThanOrEqual(1);
      expect(body.rollup.totalBreakerTrips).toBeGreaterThanOrEqual(1);
      expect(typeof body.rollup.pendingApprovals).toBe('number');
    });
  });

  // =========================================================================
  // Scenario 3 — timeline
  // =========================================================================
  describe('Scenario 3 — timeline', () => {
    it('merges runs/actions/lifecycle, newest first, with all three kinds present', async () => {
      const res = await request(http)
        .get(`/api/v1/agents/${agentId}/timeline?limit=50`)
        .set(auth())
        .expect(200);

      const body = res.body as Array<{ at: string; kind: string; ref: string }>;
      expect(Array.isArray(body)).toBe(true);

      // Sorted descending by timestamp.
      for (let i = 0; i + 1 < body.length; i++) {
        expect(body[i].at >= body[i + 1].at).toBe(true);
      }

      const kinds = new Set(body.map((e) => e.kind));
      expect(kinds.has('run')).toBe(true);
      expect(kinds.has('action')).toBe(true);
      expect(kinds.has('lifecycle')).toBe(true);
    });
  });

  // =========================================================================
  // Scenario 4 — projection (rule 26): no secretHash / serviceUserId leak.
  // =========================================================================
  describe('Scenario 4 — projection (rule 26)', () => {
    it('none of the three responses expose secretHash or serviceUserId', async () => {
      const [kpis, ct, tl] = await Promise.all([
        request(http).get(`/api/v1/agents/${agentId}/kpis`).set(auth()).expect(200),
        request(http).get('/api/v1/agents/control-tower').set(auth()).expect(200),
        request(http).get(`/api/v1/agents/${agentId}/timeline?limit=50`).set(auth()).expect(200),
      ]);
      for (const res of [kpis, ct, tl]) {
        const json = JSON.stringify(res.body);
        expect(json).not.toContain('secretHash');
        expect(json).not.toContain('serviceUserId');
      }
    });
  });

  // =========================================================================
  // Scenario 5 — isolation: control-tower is the acme tenant (seeded agent present).
  // =========================================================================
  describe('Scenario 5 — isolation', () => {
    it('control-tower includes the seeded agent and every item has the expected shape', async () => {
      const res = await request(http)
        .get('/api/v1/agents/control-tower')
        .set(auth())
        .expect(200);

      const body = res.body as {
        items: Array<{ id: string; name: string; status: string; kpis: unknown }>;
      };
      expect(body.items.some((i) => i.id === agentId)).toBe(true);
      for (const item of body.items) {
        expect(typeof item.id).toBe('string');
        expect(typeof item.name).toBe('string');
        expect(typeof item.status).toBe('string');
        expect(item.kpis).toBeTruthy();
      }
    });
  });
});
