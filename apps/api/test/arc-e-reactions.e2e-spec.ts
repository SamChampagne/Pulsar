/**
 * E2E arc-E reactions — 3 new RUN_ACTION reactions.
 *
 * Covers:
 *   1. open_maintenance_order  — fleet.maintenance.due → PREVENTIVE MaintenanceOrder
 *                                created for the due asset; 2nd trigger = no duplicate (open WO present).
 *   2. assign_dock_appointment — yard.visit.checked-in (visit with appointmentId whose
 *                                appointment has a spotId) → visit ASSIGNED to that spot +
 *                                YardMove row; 2nd trigger = no-op (already has spot).
 *   3. close_delivered_transport_order — load.completed with COMPLETED orders → orders
 *                                        become CLOSED; 2nd trigger = no-op.
 *      Module-disabled: transportation module removed → no-op for reaction 3.
 *
 * Bootstrap mirrors cross-module-automation.e2e-spec.ts:
 *   - FakeAgentRuntimeService (no Hermes)
 *   - Login as seeded admin, resolve acme tenantId
 *   - Seed master data with unique suffixes
 *   - Create RUN_ACTION rules via POST /automation/rules
 *   - Drive real triggers then call domainEvents.processPending()
 *   - Assert side effects via Prisma reads
 *
 * Prerequisites: running Postgres, db:migrate + db:seed applied.
 * Run: pnpm --filter @pulsar/api test:e2e -- arc-e-reactions
 */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AgentRuntimeService } from '../src/core/agents/agent-runtime.service';
import { DomainEventsService } from '../src/core/operating/domain-events.service';
import { drainInheritedDomainEvents } from './utils/domain-events';
import { AgentsService } from '../src/core/agents/agents.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };

// ---------------------------------------------------------------------------
// Stub — no-op AgentRuntimeService so app boots without a real Hermes process.
// ---------------------------------------------------------------------------
@Injectable()
class FakeAgentRuntimeService {
  constructor(private readonly _agents: AgentsService) {}
  async openSession(): Promise<string> { return 'fake-session'; }
  async *sendTurn(): AsyncGenerator<never> { /* no turns */ }
  async closeSession(): Promise<void> { /* no-op */ }
  async killAgentSessions(): Promise<void> { /* no-op */ }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('Arc-E reactions (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let domainEvents: DomainEventsService;
  let token = '';
  let tenantId = '';

  const suffix = `${Date.now()}-ae`;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Cleanup IDs
  const cleanupRuleIds: string[] = [];
  const cleanupMaintenanceOrderIds: string[] = [];
  const cleanupYardVisitIds: string[] = [];
  const cleanupAppointmentIds: string[] = [];
  const cleanupSpotIds: string[] = [];
  const cleanupYardMoveIds: string[] = [];
  let yardLocationId = '';
  let vehicleId = '';

  // For reaction 3 (close_delivered_transport_order)
  let customerId = '';
  let originId = '';
  let destId = '';
  let carrierId = '';

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
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

    prisma = app.get(PrismaService);
    domainEvents = app.get(DomainEventsService);
    await drainInheritedDomainEvents(domainEvents);

    // Login
    const login = await request(http).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = (login.body as { accessToken: string }).accessToken;

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'acme' } });
    tenantId = tenant.id;

    // Ensure fleet, yard, transportation modules are enabled for acme
    for (const key of ['fleet', 'yard', 'transportation']) {
      const mod = await prisma.moduleDefinition.findUniqueOrThrow({ where: { key } });
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
        update: { enabled: true },
        create: { tenantId, moduleId: mod.id, enabled: true, enabledAt: new Date() },
      });
    }

    // Ensure service account exists (reaction executor needs it)
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId, email: 'service-account@pulsar.local' } },
      update: {},
      create: {
        tenantId,
        email: 'service-account@pulsar.local',
        passwordHash: 'x',
        firstName: 'Service',
        lastName: 'Account',
        status: 'DISABLED',
      },
    });

    // Seed shared master data for reaction 3
    const customer = await prisma.customer.create({
      data: { tenantId, code: `AE-CUST-${suffix}`, name: `AE Customer ${suffix}` },
    });
    customerId = customer.id;

    const origin = await prisma.location.create({
      data: {
        tenantId, code: `AE-ORIG-${suffix}`, name: `AE Origin ${suffix}`,
        addressLine1: '1 AE St', city: 'Montreal', country: 'CA',
      },
    });
    originId = origin.id;

    const dest = await prisma.location.create({
      data: {
        tenantId, code: `AE-DEST-${suffix}`, name: `AE Dest ${suffix}`,
        addressLine1: '2 AE Ave', city: 'Toronto', country: 'CA',
      },
    });
    destId = dest.id;

    const carrier = await prisma.carrier.create({
      data: { tenantId, code: `AE-CARR-${suffix}`, name: `AE Carrier ${suffix}` },
    });
    carrierId = carrier.id;

    // Seed a vehicle for reaction 1
    const vehicle = await prisma.vehicle.create({
      data: {
        tenantId,
        unitNumber: `AE-VEH-${suffix}`,
        make: 'Test',
        model: 'Truck',
        year: 2020,
        status: 'AVAILABLE',
      },
    });
    vehicleId = vehicle.id;

    // Seed a yard location for reaction 2
    const yardLoc = await prisma.location.create({
      data: {
        tenantId, code: `AE-YARD-${suffix}`, name: `AE Yard ${suffix}`,
        type: 'WAREHOUSE', addressLine1: '3 Yard Blvd', city: 'Laval', country: 'CA',
      },
    });
    yardLocationId = yardLoc.id;
  });

  afterAll(async () => {
    if (prisma) {
      // Collect domain events this suite emitted
      const ownedEvents = await prisma.domainEvent.findMany({
        where: {
          tenantId,
          OR: [
            { type: 'fleet.maintenance.due', payload: { path: ['assetId'], string_contains: vehicleId } },
            { type: 'yard.visit.checked-in', payload: { path: ['locationId'], equals: yardLocationId } },
          ],
        },
        select: { id: true },
      }).catch(() => [] as { id: string }[]);

      // Also collect load.completed events from this suite
      const loadEvents = await prisma.domainEvent.findMany({
        where: { tenantId, type: 'load.completed' },
        select: { id: true },
      }).catch(() => [] as { id: string }[]);

      const allEventIds = [...ownedEvents, ...loadEvents].map((e) => e.id);

      await prisma.reactionExecution.deleteMany({ where: { tenantId, eventId: { in: allEventIds } } }).catch(() => undefined);
      await prisma.domainEvent.deleteMany({ where: { tenantId, id: { in: allEventIds } } }).catch(() => undefined);

      await prisma.maintenanceOrder.deleteMany({ where: { id: { in: cleanupMaintenanceOrderIds } } }).catch(() => undefined);
      await prisma.yardMove.deleteMany({ where: { visitId: { in: cleanupYardVisitIds } } }).catch(() => undefined);
      await prisma.yardVisit.deleteMany({ where: { id: { in: cleanupYardVisitIds } } }).catch(() => undefined);
      await prisma.dockAppointment.deleteMany({ where: { id: { in: cleanupAppointmentIds } } }).catch(() => undefined);
      await prisma.yardSpot.deleteMany({ where: { id: { in: cleanupSpotIds } } }).catch(() => undefined);
      await prisma.maintenanceOrder.deleteMany({ where: { tenantId, vehicleId } }).catch(() => undefined);

      // Reaction 3 cleanup (loads/shipments/orders)
      const cleanupLoads = await prisma.load.findMany({ where: { tenantId, loadNumber: { startsWith: 'LD-' } }, select: { id: true } }).catch(() => [] as { id: string }[]);
      const loadIds = cleanupLoads.map((l) => l.id);
      await prisma.shipmentLoadLeg.deleteMany({ where: { load: { tenantId, loadNumber: { startsWith: 'LD-' } } } }).catch(() => undefined);
      await prisma.shipment.deleteMany({ where: { tenantId, transportOrder: { customerId } } }).catch(() => undefined);
      await prisma.load.deleteMany({ where: { id: { in: loadIds } } }).catch(() => undefined);
      await prisma.transportOrder.deleteMany({ where: { tenantId, customerId } }).catch(() => undefined);

      await prisma.automationRule.deleteMany({ where: { id: { in: cleanupRuleIds } } }).catch(() => undefined);
      await prisma.vehicle.deleteMany({ where: { id: vehicleId } }).catch(() => undefined);
      await prisma.location.deleteMany({ where: { id: { in: [originId, destId, yardLocationId].filter(Boolean) } } }).catch(() => undefined);
      await prisma.carrier.deleteMany({ where: { id: carrierId } }).catch(() => undefined);
      await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    }
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Reaction 1 — open_maintenance_order
  // ---------------------------------------------------------------------------
  describe('Reaction 1 — open_maintenance_order', () => {
    let ruleId = '';

    beforeAll(async () => {
      // Create the automation rule
      const ruleRes = await request(http)
        .post('/api/v1/automation/rules')
        .set(auth())
        .send({
          name: `AE open-MO rule ${suffix}`,
          eventType: 'fleet.maintenance.due',
          match: 'ALL',
          conditions: [],
          action: {
            kind: 'RUN_ACTION',
            action: 'open_maintenance_order',
            args: {
              assetKind: '{assetKind}',
              assetId: '{assetId}',
              scheduleId: '{scheduleId}',
              name: '{name}',
            },
          },
        })
        .expect(201);
      ruleId = (ruleRes.body as { id: string }).id;
      cleanupRuleIds.push(ruleId);
    });

    it('fleet.maintenance.due → processPending → PREVENTIVE MaintenanceOrder created for the asset', async () => {
      // Emit the event directly (mirrors the cron emitter)
      await domainEvents.emit(
        tenantId,
        'fleet.maintenance.due',
        { type: 'vehicle', id: vehicleId },
        {
          scheduleId: `sched-${suffix}`,
          name: 'Révision 6 mois',
          assetKind: 'vehicle',
          assetId: vehicleId,
          assetLabel: `AE-VEH-${suffix}`,
          status: 'DUE',
          nextDueDate: new Date().toISOString(),
          nextDueKm: null,
          cycle: `cycle-${suffix}`,
        },
      );

      await domainEvents.processPending(50);

      const wo = await prisma.maintenanceOrder.findFirst({
        where: {
          tenantId,
          vehicleId,
          type: 'PREVENTIVE',
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      });
      expect(wo).not.toBeNull();
      expect(wo!.type).toBe('PREVENTIVE');
      if (wo) cleanupMaintenanceOrderIds.push(wo.id);

      // Ledger row should be EXECUTED
      const event = await prisma.domainEvent.findFirst({
        where: { tenantId, type: 'fleet.maintenance.due', payload: { path: ['assetId'], equals: vehicleId } },
      });
      expect(event).not.toBeNull();
      const ledger = await prisma.reactionExecution.findFirst({
        where: { tenantId, eventId: event!.id, ruleId },
      });
      expect(ledger).not.toBeNull();
      expect(ledger!.status).toBe('EXECUTED');
    });

    it('2nd trigger: open WO already present → no second MaintenanceOrder created (idempotent)', async () => {
      // Emit the same type of event again
      await domainEvents.emit(
        tenantId,
        'fleet.maintenance.due',
        { type: 'vehicle', id: vehicleId },
        {
          scheduleId: `sched-${suffix}`,
          name: 'Révision 6 mois',
          assetKind: 'vehicle',
          assetId: vehicleId,
          assetLabel: `AE-VEH-${suffix}`,
          status: 'DUE',
          nextDueDate: new Date().toISOString(),
          nextDueKm: null,
          cycle: `cycle-${suffix}-2`,
        },
      );

      await domainEvents.processPending(50);

      // Still exactly one non-terminal WO for this vehicle
      const wos = await prisma.maintenanceOrder.findMany({
        where: {
          tenantId,
          vehicleId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      });
      expect(wos).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Reaction 2 — assign_dock_appointment
  // ---------------------------------------------------------------------------
  describe('Reaction 2 — assign_dock_appointment', () => {
    let ruleId = '';
    let spotId = '';
    let appointmentId = '';
    let visitId = '';

    beforeAll(async () => {
      // Create the automation rule
      const ruleRes = await request(http)
        .post('/api/v1/automation/rules')
        .set(auth())
        .send({
          name: `AE assign-dock rule ${suffix}`,
          eventType: 'yard.visit.checked-in',
          match: 'ALL',
          conditions: [],
          action: {
            kind: 'RUN_ACTION',
            action: 'assign_dock_appointment',
            args: { visitId: '{visitId}' },
          },
        })
        .expect(201);
      ruleId = (ruleRes.body as { id: string }).id;
      cleanupRuleIds.push(ruleId);

      // Create a YardSpot (DOCK_DOOR type) via API
      const spotRes = await request(http)
        .post('/api/v1/yard/spots')
        .set(auth())
        .send({ locationId: yardLocationId, code: `AE-SPOT-${suffix}`, type: 'DOCK_DOOR' })
        .expect(201);
      spotId = (spotRes.body as { id: string }).id;
      cleanupSpotIds.push(spotId);

      // Create a DockAppointment with a spotId
      const apptRes = await request(http)
        .post('/api/v1/yard/appointments')
        .set(auth())
        .send({
          locationId: yardLocationId,
          spotId,
          windowStart: new Date(Date.now() + 3600_000).toISOString(),
          windowEnd: new Date(Date.now() + 7200_000).toISOString(),
          reference: `AE-APPT-${suffix}`,
        })
        .expect(201);
      appointmentId = (apptRes.body as { id: string }).id;
      cleanupAppointmentIds.push(appointmentId);
    });

    it('check-in a visit with appointmentId → processPending → visit ASSIGNED to spot + YardMove exists', async () => {
      // Check in a visit referencing the appointment
      const visitRes = await request(http)
        .post('/api/v1/yard/visits')
        .set(auth())
        .send({
          locationId: yardLocationId,
          appointmentId,
          direction: 'INBOUND',
        })
        .expect(201);
      visitId = (visitRes.body as { id: string }).id;
      cleanupYardVisitIds.push(visitId);

      // The check-in emits yard.visit.checked-in; run the worker
      await domainEvents.processPending(50);

      // Visit should now be ASSIGNED to the spot
      const visit = await prisma.yardVisit.findUniqueOrThrow({ where: { id: visitId } });
      expect(visit.status).toBe('ASSIGNED');
      expect(visit.spotId).toBe(spotId);

      // A YardMove should exist
      const move = await prisma.yardMove.findFirst({ where: { visitId } });
      expect(move).not.toBeNull();

      // Ledger row should be EXECUTED
      const event = await prisma.domainEvent.findFirst({
        where: { tenantId, type: 'yard.visit.checked-in', payload: { path: ['visitId'], equals: visitId } },
      });
      expect(event).not.toBeNull();
      const ledger = await prisma.reactionExecution.findFirst({
        where: { tenantId, eventId: event!.id, ruleId },
      });
      expect(ledger).not.toBeNull();
      expect(ledger!.status).toBe('EXECUTED');
    });

    it('2nd trigger (re-emit event for same visit): visit already has spot → no-op (no additional YardMove)', async () => {
      // Count YardMoves before
      const movesBefore = await prisma.yardMove.count({ where: { visitId } });
      expect(movesBefore).toBeGreaterThanOrEqual(1);

      // Emit a second yard.visit.checked-in event for the same visit (manually, as the real
      // check-in already happened). The handler should skip (visit.spotId already set).
      await domainEvents.emit(
        tenantId,
        'yard.visit.checked-in',
        { type: 'yard-visit', id: visitId },
        {
          visitId,
          visitNumber: 'YV-TEST-2',
          locationId: yardLocationId,
          trailerLabel: null,
          trailerId: null,
          carrierId: null,
          direction: 'INBOUND',
        },
      );
      await domainEvents.processPending(50);

      const movesAfter = await prisma.yardMove.count({ where: { visitId } });
      expect(movesAfter).toBe(movesBefore); // no new move created
    });
  });

  // ---------------------------------------------------------------------------
  // Reaction 3 — close_delivered_transport_order
  // ---------------------------------------------------------------------------
  describe('Reaction 3 — close_delivered_transport_order', () => {
    let ruleId = '';

    beforeAll(async () => {
      // Create the automation rule
      const ruleRes = await request(http)
        .post('/api/v1/automation/rules')
        .set(auth())
        .send({
          name: `AE close-order rule ${suffix}`,
          eventType: 'load.completed',
          match: 'ALL',
          conditions: [],
          action: {
            kind: 'RUN_ACTION',
            action: 'close_delivered_transport_order',
            args: { loadId: '{loadId}' },
          },
        })
        .expect(201);
      ruleId = (ruleRes.body as { id: string }).id;
      cleanupRuleIds.push(ruleId);
    });

    /**
     * Helper: create order → confirm → plan → create load → assign shipment →
     * assign carrier → dispatch → start-transit → complete.
     */
    async function buildAndCompleteLoad(): Promise<{ orderId: string; loadId: string }> {
      const orderRes = await request(http)
        .post('/api/v1/transportation/transport-orders')
        .set(auth())
        .send({ customerId, originLocationId: originId, destinationLocationId: destId })
        .expect(201);
      const orderId = (orderRes.body as { id: string }).id;

      await request(http)
        .post(`/api/v1/transportation/transport-orders/${orderId}/confirm`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));

      const planRes = await request(http)
        .post(`/api/v1/transportation/transport-orders/${orderId}/plan`)
        .set(auth())
        .expect((r) => expect([200, 201]).toContain(r.status));
      const shipmentId = (planRes.body as { shipments: Array<{ id: string }> }).shipments[0].id;

      const loadRes = await request(http)
        .post('/api/v1/transportation/loads')
        .set(auth())
        .send({})
        .expect(201);
      const loadId = (loadRes.body as { id: string }).id;

      await request(http)
        .post(`/api/v1/transportation/shipments/${shipmentId}/assign-load`)
        .set(auth())
        .send({ loadId })
        .expect(201);

      await request(http)
        .post(`/api/v1/transportation/loads/${loadId}/assign`)
        .set(auth())
        .send({ carrierId })
        .expect(201);

      // Drain any pending events (e.g. transport-order.planned) before completing
      await domainEvents.processPending(50);

      await request(http).post(`/api/v1/transportation/loads/${loadId}/dispatch`).set(auth()).expect(201);
      await request(http).post(`/api/v1/transportation/loads/${loadId}/start-transit`).set(auth()).expect(201);
      await request(http).post(`/api/v1/transportation/loads/${loadId}/complete`).set(auth()).expect(201);

      return { orderId, loadId };
    }

    it('load.completed → processPending → transport order becomes CLOSED', async () => {
      const { orderId, loadId } = await buildAndCompleteLoad();

      // The order should be COMPLETED right after the load completes
      const orderBefore = await prisma.transportOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(orderBefore.status).toBe('COMPLETED');

      // Process the load.completed event
      await domainEvents.processPending(50);

      // Now the order should be CLOSED
      const orderAfter = await prisma.transportOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(orderAfter.status).toBe('CLOSED');

      // Ledger row EXECUTED
      const event = await prisma.domainEvent.findFirst({
        where: { tenantId, type: 'load.completed', payload: { path: ['loadId'], equals: loadId } },
      });
      expect(event).not.toBeNull();
      const ledger = await prisma.reactionExecution.findFirst({
        where: { tenantId, eventId: event!.id, ruleId },
      });
      expect(ledger).not.toBeNull();
      expect(ledger!.status).toBe('EXECUTED');
    });

    it('2nd trigger (re-emit load.completed for already-CLOSED order): no-op', async () => {
      // Build a fresh load and complete it to get the orderId
      const { orderId, loadId } = await buildAndCompleteLoad();
      await domainEvents.processPending(50); // first pass → order CLOSED

      const orderMid = await prisma.transportOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(orderMid.status).toBe('CLOSED');

      // Emit a second load.completed event for the same loadId
      await domainEvents.emit(
        tenantId,
        'load.completed',
        { type: 'load', id: loadId },
        { loadId, loadNumber: `LD-${suffix}-dup` },
      );
      await domainEvents.processPending(50);

      // Order remains CLOSED (not double-closed or errored)
      const orderFinal = await prisma.transportOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(orderFinal.status).toBe('CLOSED');
    });

    it('module-disabled tenant: no-op when transportation module is removed', async () => {
      // Create a second tenant without the transportation module
      const t2 = await prisma.tenant.create({
        data: { slug: `ae-notms-${suffix}`, name: `AE NoTMS ${suffix}`, status: 'ACTIVE' },
      });
      const t2Id = t2.id;

      try {
        // Seed service account for t2
        await prisma.user.create({
          data: {
            tenantId: t2Id,
            email: 'service-account@pulsar.local',
            passwordHash: 'x',
            firstName: 'Service',
            lastName: 'Account',
            status: 'DISABLED',
          },
        });

        // Create a close rule for t2 (no transportation module enabled)
        await prisma.automationRule.create({
          data: {
            tenantId: t2Id,
            name: 'AE close rule (no transport)',
            eventType: 'load.completed',
            enabled: true,
            match: 'ALL',
            conditions: [],
            action: { kind: 'RUN_ACTION', action: 'close_delivered_transport_order', args: { loadId: '{loadId}' } },
          },
        });

        // Emit a load.completed event for t2
        await domainEvents.emit(
          t2Id,
          'load.completed',
          { type: 'load', id: `fake-load-${suffix}` },
          { loadId: `fake-load-${suffix}`, loadNumber: 'LD-NOTMS' },
        );
        await domainEvents.processPending(50);

        // No ReactionExecution for t2 (module guard fired → no-op, ledger not inserted)
        const ledgerCount = await prisma.reactionExecution.count({ where: { tenantId: t2Id } });
        expect(ledgerCount).toBe(0);
      } finally {
        // Cleanup t2
        await prisma.reactionExecution.deleteMany({ where: { tenantId: t2Id } }).catch(() => undefined);
        await prisma.domainEvent.deleteMany({ where: { tenantId: t2Id } }).catch(() => undefined);
        await prisma.automationRule.deleteMany({ where: { tenantId: t2Id } }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { tenantId: t2Id } }).catch(() => undefined);
        await prisma.tenantModule.deleteMany({ where: { tenantId: t2Id } }).catch(() => undefined);
        await prisma.tenant.deleteMany({ where: { id: t2Id } }).catch(() => undefined);
      }
    });
  });
});
