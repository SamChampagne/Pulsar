/** HTTP + real PostgreSQL. The solver is a controlled stub here; Python's bridge
 * suite separately runs the real solvers. This suite never skips without APS. */
process.env.APS_AUTOSTART = 'false';
import { randomUUID } from 'node:crypto';
import { INestApplication, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApsClient } from '../src/core/aps/aps.client';
import {
  APS_ENGINE_REVISION,
  APS_ENGINE_V2,
  APS_BRIDGE_V2,
  type ApsBridgeRequest,
} from '../src/core/aps/aps.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantModulesCacheService } from '../src/prisma/tenant-modules-cache.service';

describe('Manufacturing APS bridge (HTTP, durable artifacts and concurrency)', () => {
  let app: INestApplication, db: PrismaService, http: any, tenantId: string;
  let token: string, reader: string, otherToken: string, runId: string;
  // Optional second pass through a live private sidecar, without making CI skip.
  const real =
    process.env.PULSAR_TEST_REAL_APS === 'true'
      ? new ApsClient(new ConfigService(process.env))
      : null;
  const engine = {
    runForTenant: jest.fn(async (tenant: string, input: ApsBridgeRequest) =>
      real
        ? real.runForTenant(tenant, input)
        : {
            bridge_version: input.bridge_version,
            engine_revision:
              input.bridge_version === APS_BRIDGE_V2 ? APS_ENGINE_V2 : APS_ENGINE_REVISION,
            engine_version: 'aps-engine.v1',
            time_zone: input.time_zone,
            organization_id: tenant,
            schedule_id: randomUUID(),
            created_at: '2026-01-05T00:00:00',
            strategy: 'greedy',
            solver_status: 'feasible',
            objective_value: 0,
            wall_time_ms: 1,
            horizon_start: input.horizon_start,
            horizon_end:
              input.bridge_version === APS_BRIDGE_V2
                ? input.horizon_end
                : new Date(
                    Date.parse(`${input.horizon_start}Z`) + (input.horizon_days ?? 30) * 86_400_000,
                  )
                    .toISOString()
                    .slice(0, 19),
            metrics: { makespan_minutes: 60 },
            diagnostics: { planner_exceptions: { status: 'ready' } },
            summary: {},
            analysis: {},
            feasibility: {},
            assignments: input.snapshot.work_orders!.flatMap((o) =>
              o.operations.map((op) => ({
                operation_id: op.id,
                work_order_id: o.id,
                machine_id: op.eligible_machine_ids[0],
                setup_start: '2026-01-05T08:00:00',
                start: '2026-01-05T08:00:00',
                end: '2026-01-05T09:00:00',
              })),
            ),
          },
    ),
    checkPublication: jest.fn(async (_tenant: string, _candidate: unknown, _baseline: unknown) =>
      real
        ? real.checkPublication(_tenant, _candidate, _baseline)
        : { publish_status: 'publishable', recommendation: 'Valid scenario' },
    ),
    reviewPublication: jest.fn(async (tenant: string, candidate: unknown, baseline: unknown) =>
      real
        ? real.reviewPublication(tenant, candidate, baseline)
        : {
            publish_status: 'publishable',
            recommendation: 'Valid scenario',
            comparison: null,
          },
    ),
    health: jest.fn(async () => ({ status: 'ok' })),
  };
  const post = (path: string, body = {}, t = token) =>
    request(http)
      .post(`/api/v1/manufacturing/scheduling/${path}`)
      .set('Authorization', `Bearer ${t}`)
      .send(body);
  const get = (path: string, t = token) =>
    request(http)
      .get(`/api/v1/manufacturing/scheduling/${path}`)
      .set('Authorization', `Bearer ${t}`);
  const calculate = async () =>
    (await post('run', { horizonStart: '2026-01-05', horizonDays: 7 }).expect(201)).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ApsClient)
      .useValue(engine)
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    db = app.get(PrismaService);
    const module = await db.moduleDefinition.findUniqueOrThrow({ where: { key: 'manufacturing' } });
    for (const name of ['main', 'other']) {
      const slug = `aps-bridge-${name}-${randomUUID()}`;
      const tenant = await db.tenant.create({ data: { slug, name: slug } });
      await db.tenantModule.create({
        data: { tenantId: tenant.id, moduleId: module.id, enabled: true },
      });
      for (const mode of name === 'main' ? ['manager', 'reader'] : ['manager']) {
        const keys = [
          'manufacturing.read',
          ...(mode === 'manager' ? ['manufacturing.manage'] : []),
        ];
        const perms = await db.permission.findMany({ where: { key: { in: keys } } });
        expect(perms).toHaveLength(keys.length);
        const role = await db.role.create({
          data: {
            tenantId: tenant.id,
            key: mode,
            name: mode,
            permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
          },
        });
        const email = `${mode}@${slug}.test`;
        await db.user.create({
          data: {
            tenantId: tenant.id,
            email,
            firstName: 'APS',
            lastName: mode,
            status: 'ACTIVE',
            passwordHash: hashSync('Test1234!', 4),
            roles: { create: { roleId: role.id } },
          },
        });
        const auth = await request(http)
          .post('/api/v1/auth/login')
          .send({ tenant: slug, email, password: 'Test1234!' })
          .expect(200);
        if (name === 'other') otherToken = auth.body.accessToken;
        else if (mode === 'reader') reader = auth.body.accessToken;
        else {
          token = auth.body.accessToken;
          tenantId = tenant.id;
        }
      }
    }
    const cal = await db.workingCalendar.create({
      data: {
        tenantId,
        code: 'CAL',
        name: 'Week',
        shifts: { create: [{ tenantId, weekday: 0, startTime: '08:00', endTime: '17:00' }] },
      },
    });
    const machine = await db.workCenter.create({
      data: { tenantId, code: 'CUT', name: 'Cut', calendarId: cal.id },
    });
    const order = await request(http)
      .post('/api/v1/manufacturing/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Bridge order',
        productRef: 'P',
        quantity: 1,
        releaseDate: '2026-01-05T08:00:00Z',
        dueDate: '2026-01-09T17:00:00Z',
        operations: [
          { sequence: 1, name: 'Cut', durationMinutes: 60, eligibleWorkCenterIds: [machine.id] },
        ],
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/manufacturing/orders/${order.body.id}/release`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  }, 60_000);
  afterAll(async () => {
    await app?.close();
  });

  it('persists exact request, hash, full result and explicit UTC timestamps', async () => {
    const run = await calculate();
    runId = run.id;
    expect(run.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(run.inputRequest.horizon_start).toBe('2026-01-05T00:00:00');
    expect(run.engineResult.metrics.makespan_minutes).toEqual(expect.any(Number));
    expect(run.timeZone).toBe('UTC');
    expect(run.assignments[0].start).toBe('2026-01-05T08:00:00.000Z');
    const list = await get('runs').expect(200);
    expect(list.body.items[0]).not.toHaveProperty('inputRequest');
    expect(list.body.items[0]).not.toHaveProperty('engineResult');
  });
  it('enforces read/manage rights and isolates detail/replay/publication', async () => {
    await get(`runs/${runId}`, reader).expect(200);
    await post(`runs/${runId}/replay`, {}, reader).expect(403);
    await post(`runs/${runId}/publish`, {}, reader).expect(403);
    await get(`runs/${runId}`, otherToken).expect(404);
    await post(`runs/${runId}/replay`, {}, otherToken).expect(404);
    await post(`runs/${runId}/publish`, {}, otherToken).expect(404);
    await get(`runs/${runId}/review`, reader).expect(200);
    await get(`runs/${runId}/review`, otherToken).expect(404);
  });
  it('captures a zoned v2 scenario without changing v1 history', async () => {
    const r = (
      await post('run', {
        timeZone: 'America/Toronto',
        horizonDate: '2026-01-05',
        horizonDays: 7,
      }).expect(201)
    ).body;
    expect(r.bridgeVersion).toBe(APS_BRIDGE_V2);
    expect(r.timeZone).toBe('America/Toronto');
    expect(r.inputRequest.horizon_start).toBe('2026-01-05T05:00:00');
    expect(Object.values(r.inputRequest.calendar_windows)[0]).toEqual([
      { start: '2026-01-05T13:00:00', end: '2026-01-05T22:00:00' },
    ]);
    if (real) expect(r.assignments[0].start).toBe('2026-01-05T13:00:00.000Z');
    const replay = (await post(`runs/${r.id}/replay`).expect(201)).body;
    expect(replay.inputRequest).toEqual(r.inputRequest);
    expect(replay.assignments.map((a: any) => a.start)).toEqual(
      r.assignments.map((a: any) => a.start),
    );
    await post(`runs/${replay.id}/publish`).expect(409);
    await post('run', { timeZone: 'Unknown/Zone' }).expect(400);
    await post('run', { horizonDate: '2026-01-05' }).expect(400);
    await post('run', { timeZone: 'UTC', horizonStart: '2026-01-05' }).expect(400);
  });
  it('reviews without writing and binds confirmation to the inspected evidence', async () => {
    const before = await db.schedulingRun.count({ where: { tenantId, isBaseline: true } });
    const r = await get(`runs/${runId}/review`).expect(200);
    expect(r.body.canPublish).toBe(true);
    expect(r.body.reviewToken).toMatch(/^[a-f0-9]{64}$/);
    expect(await db.schedulingRun.count({ where: { tenantId, isBaseline: true } })).toBe(before);
    await post(`runs/${runId}/publish`, { reviewToken: 'a'.repeat(64) }).expect(409);
    await post(`runs/${runId}/publish`, { allowReview: true }).expect(400);
  });
  it('shows a review-required assessment but never permits a forced publication', async () => {
    engine.reviewPublication.mockResolvedValueOnce({
      publish_status: 'review',
      recommendation: 'Review needed',
      comparison: null,
    });
    const r = await get(`runs/${runId}/review`).expect(200);
    expect(r.body.canPublish).toBe(false);
    expect(r.body.blockers).not.toHaveLength(0);
    engine.reviewPublication.mockResolvedValueOnce({
      publish_status: 'review',
      recommendation: 'Review needed',
      comparison: null,
    });
    await post(`runs/${runId}/publish`, { reviewToken: r.body.reviewToken }).expect(409);
  });
  it('replays exact captured inputs as a new historical, non-publishable candidate', async () => {
    const original = (await get(`runs/${runId}`).expect(200)).body;
    const replay = (await post(`runs/${runId}/replay`).expect(201)).body;
    expect(replay.id).not.toBe(runId);
    expect(replay.replayedFromId).toBe(runId);
    expect(replay.snapshotHash).toBe(original.snapshotHash);
    expect(replay.inputRequest).toEqual(original.inputRequest);
    await post(`runs/${replay.id}/publish`).expect(409);
  });
  it('does not save partial runs on unavailable engine or invalid response', async () => {
    const count = await db.schedulingRun.count({ where: { tenantId } });
    engine.runForTenant.mockRejectedValueOnce(new ServiceUnavailableException('Unavailable'));
    await post('run').expect(503);
    engine.runForTenant.mockResolvedValueOnce({ organization_id: 'foreign' } as any);
    await post('run').expect(503);
    expect(await db.schedulingRun.count({ where: { tenantId } })).toBe(count);
  });
  it('requires material context and valid horizons before calling the engine', async () => {
    const before = engine.runForTenant.mock.calls.length;
    await post('run', { respectMaterials: true }).expect(400);
    await post('run', { horizonStart: '2026-02-30' }).expect(400);
    expect(engine.runForTenant.mock.calls.length).toBe(before);
  });
  it('fails closed on missing or negative publication decisions', async () => {
    engine.checkPublication.mockRejectedValueOnce(new ServiceUnavailableException('Offline'));
    await post(`runs/${runId}/publish`).expect(503);
    engine.checkPublication.mockResolvedValueOnce({
      publish_status: 'blocked',
      recommendation: 'Blocked',
    });
    await post(`runs/${runId}/publish`).expect(503);
    expect(await db.schedulingRun.count({ where: { tenantId, isBaseline: true } })).toBe(0);
  });
  it('publishes and safely repeats the same request without rerunning the gate', async () => {
    const review = await get(`runs/${runId}/review`).expect(200);
    await post(`runs/${runId}/publish`, { reviewToken: review.body.reviewToken }).expect(201);
    const calls = engine.checkPublication.mock.calls.length;
    await post(`runs/${runId}/publish`).expect(201);
    await request(http)
      .post(`/api/v1/manufacturing/scheduling/runs/${runId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(engine.checkPublication.mock.calls.length).toBe(calls);
    expect((await get('baseline').expect(200)).body.id).toBe(runId);
  });
  it('serializes concurrent candidates: one winner and one conflict, exactly one baseline', async () => {
    const a = await calculate(),
      b = await calculate();
    const results = await Promise.all([post(`runs/${a.id}/publish`), post(`runs/${b.id}/publish`)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.schedulingRun.count({ where: { tenantId, isBaseline: true } })).toBe(1);
    // The superseded candidate cannot be used to roll the baseline back.
    await post(`runs/${runId}/publish`).expect(409);
  });
  it('does not publish or replay a legacy run without captured evidence', async () => {
    const legacy = await db.schedulingRun.create({
      data: { tenantId, strategy: 'greedy', solverStatus: 'feasible' },
    });
    await post(`runs/${legacy.id}/publish`).expect(409);
    await post(`runs/${legacy.id}/replay`).expect(409);
  });
  it('rejects a candidate when manufacturing data changed after calculation', async () => {
    const candidate = await calculate();
    const currentBaseline = (await get('baseline').expect(200)).body.id;
    await db.manufacturingOrder.updateMany({
      where: { tenantId },
      data: { name: 'Updated production demand' },
    });
    const review = await get(`runs/${candidate.id}/review`).expect(200);
    expect(review.body.canPublish).toBe(false);
    expect(review.body.blockers.join(' ')).toContain('changé');
    await post(`runs/${candidate.id}/publish`).expect(409);
    expect((await get('baseline').expect(200)).body.id).toBe(currentBaseline);
  });
  it('gates replay when Manufacturing is disabled', async () => {
    await db.tenantModule.updateMany({ where: { tenantId }, data: { enabled: false } });
    app.get(TenantModulesCacheService).invalidate(tenantId);
    await post(`runs/${runId}/replay`).expect(403);
    await get(`runs/${runId}/review`).expect(403);
  });
});
