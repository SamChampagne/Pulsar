import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, LoadStatus, TenderStatus, TrackingEventType } from '@pulsar/shared';
import { randomBytes } from 'node:crypto';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { MailService } from '../../../core/email/mail.service';
import { WebhooksService } from '../../../core/integrations/webhooks.service';
import { ModuleSettingsService } from '../../../core/module-registry/module-settings.service';
import { DomainEventsService } from '../../../core/operating/domain-events.service';
import { LanesService } from '../lanes/lanes.service';

export interface CreateTenderInput {
  carrierId?: string;
  message?: string;
  expiresInHours?: number;
  /** Internal: marks the tender as part of an automatic lane sequence. */
  isAuto?: boolean;
}

const tenderInclude = {
  carrier: { select: { id: true, code: true, name: true, email: true } },
} as const;

@Injectable()
export class TendersService {
  private readonly logger = new Logger(TendersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogsService,
    private readonly webhooks: WebhooksService,
    private readonly mail: MailService,
    private readonly lanes: LanesService,
    private readonly domainEvents: DomainEventsService,
    private readonly moduleSettings: ModuleSettingsService,
  ) {}

  private link(token: string): string {
    return `${this.config.get('WEB_URL', 'http://localhost:5173')}/tender/${token}`;
  }

  listForLoad(tenantId: string, loadId: string) {
    return this.prisma.tender.findMany({
      where: { tenantId, loadId },
      orderBy: { sentAt: 'desc' },
      include: tenderInclude,
    });
  }

  /** Sends a tender: load PLANNED → TENDERED, a tokenized response link is generated. */
  async create(tenantId: string, userId: string | undefined, loadId: string, input: CreateTenderInput) {
    const load = await this.prisma.load.findFirst({ where: { id: loadId, tenantId } });
    if (!load) throw new NotFoundException('Load not found');
    if (load.status !== LoadStatus.PLANNED) {
      throw new BadRequestException('Only PLANNED loads can be tendered');
    }
    const tms = await this.moduleSettings.resolve(tenantId, 'transportation');
    if (tms['requireTendering'] === 'DISABLED') {
      throw new BadRequestException('Tendering is disabled by tenant policy (direct assignment only)');
    }
    const carrierId = input.carrierId ?? load.carrierId;
    if (!carrierId) {
      throw new BadRequestException('Provide a carrierId (none assigned to the load)');
    }
    await this.ownership.assertOwned('carrier', carrierId, tenantId);

    const expiresInHours = input.expiresInHours ?? 48;
    const [tender] = await this.prisma.$transaction([
      this.prisma.tender.create({
        data: {
          tenantId,
          loadId,
          carrierId,
          isAuto: input.isAuto ?? false,
          token: randomBytes(24).toString('base64url'),
          message: input.message,
          expiresAt: new Date(Date.now() + expiresInHours * 3600 * 1000),
          // Freeze the offered rate at send time — a later Load.estimatedCost recompute
          // must not retroactively change an offer the carrier already received.
          offeredAmount: load.estimatedCost,
          offeredCurrency: load.costCurrency,
        },
        include: tenderInclude,
      }),
      this.prisma.load.update({
        where: { id: loadId },
        data: { status: LoadStatus.TENDERED, carrierId },
      }),
    ]);

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'load',
      entityId: loadId,
      before: { status: LoadStatus.PLANNED },
      after: { status: LoadStatus.TENDERED, tenderId: tender.id, carrierId },
    });
    await this.webhooks.emit(tenantId, 'tender.sent', {
      loadId,
      loadNumber: load.loadNumber,
      tenderId: tender.id,
      carrierId,
    });

    // Email the response link to the carrier (best-effort; the UI also offers copy-link).
    let emailedTo: string | null = null;
    if (tender.carrier.email) {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const url = this.link(tender.token);
      // Route through the durable outbox — recorded in the tenant's email history.
      await this.mail.queue(tenantId, {
        toAddresses: [tender.carrier.email],
        subject: `Transport offer ${load.loadNumber} — ${tenant.name}`,
        html: [
          `<p>${tenant.name} is offering you load <strong>${load.loadNumber}</strong>.</p>`,
          input.message ? `<p>${input.message}</p>` : '',
          `<p><a href="${url}">Review, accept or decline the offer</a></p>`,
          `<p>This offer expires on ${tender.expiresAt.toUTCString()}.</p>`,
        ].join('\n'),
        text: `${tenant.name} is offering you load ${load.loadNumber}. Respond here: ${url}`,
        relatedType: 'tender',
        relatedId: tender.id,
      });
      emailedTo = tender.carrier.email;
    }

    return { ...tender, responseUrl: this.link(tender.token), emailedTo };
  }

  /**
   * Starts (or continues) automatic tendering using the lane preference list of
   * the load's first shipment (origin → destination). The first carrier without
   * a failed tender on this load is offered; on decline/expiry the chain
   * advances automatically (see respond() and TenderExpiryService).
   */
  async autoTender(
    tenantId: string,
    userId: string | undefined,
    loadId: string,
    expiresInHours?: number,
  ) {
    const load = await this.prisma.load.findFirst({
      where: { id: loadId, tenantId },
      select: { id: true, shipments: { select: { id: true }, take: 1 } },
    });
    if (!load) throw new NotFoundException('Load not found');
    if (load.shipments.length === 0) {
      throw new BadRequestException('Cannot auto-tender a load without shipments');
    }

    const carrierIds = await this.lanes.orderedCarrierIdsForLoad(tenantId, loadId);
    if (carrierIds.length === 0) {
      throw new BadRequestException('No carrier preference list matches this lane');
    }

    const next = await this.nextCarrierInChain(tenantId, loadId, carrierIds);
    if (!next) {
      throw new BadRequestException('All carriers on this lane have already declined');
    }
    return this.create(tenantId, userId, loadId, {
      carrierId: next,
      expiresInHours,
      isAuto: true,
    });
  }

  /** First carrier of the lane list without a DECLINED/EXPIRED tender on this load. */
  private async nextCarrierInChain(
    tenantId: string,
    loadId: string,
    laneCarrierIds: string[],
  ): Promise<string | null> {
    const failed = await this.prisma.tender.findMany({
      where: {
        tenantId,
        loadId,
        status: { in: [TenderStatus.DECLINED, TenderStatus.EXPIRED] },
      },
      select: { carrierId: true },
    });
    const excluded = new Set(failed.map((t) => t.carrierId));
    return laneCarrierIds.find((id) => !excluded.has(id)) ?? null;
  }

  /** Advances an automatic chain after a decline/expiry. Best-effort: never throws. */
  async advanceChain(tenderId: string): Promise<void> {
    try {
      const tender = await this.prisma.tender.findUnique({
        where: { id: tenderId },
        include: { load: { select: { status: true } } },
      });
      if (!tender?.isAuto || tender.load.status !== LoadStatus.PLANNED) return;

      // Respect the tenant's autoTenderOnPlan setting. When false, leave the load PLANNED.
      const tmsSettings = await this.moduleSettings.resolve(tender.tenantId, 'transportation');
      if (tmsSettings['autoTenderOnPlan'] === false) {
        this.logger.log(`Auto-tender chain skipped for load ${tender.loadId} (autoTenderOnPlan=false)`);
        return;
      }

      const carrierIds = await this.lanes.orderedCarrierIdsForLoad(tender.tenantId, tender.loadId);
      if (carrierIds.length === 0) return;
      const next = await this.nextCarrierInChain(tender.tenantId, tender.loadId, carrierIds);
      if (next) {
        await this.create(tender.tenantId, undefined, tender.loadId, {
          carrierId: next,
          isAuto: true,
        });
      }
    } catch (err) {
      // The chain stalling is recoverable by hand; log and move on.
      console.error(`Auto-tender chain advance failed for tender ${tenderId}`, err);
    }
  }

  /** Cancels the pending tender and returns the load to PLANNED. */
  async cancel(tenantId: string, userId: string, loadId: string) {
    const tender = await this.prisma.tender.findFirst({
      where: { tenantId, loadId, status: TenderStatus.PENDING },
    });
    if (!tender) throw new NotFoundException('No pending tender for this load');

    await this.prisma.$transaction([
      this.prisma.tender.update({
        where: { id: tender.id },
        data: { status: TenderStatus.CANCELLED, respondedAt: new Date() },
      }),
      this.prisma.load.update({ where: { id: loadId }, data: { status: LoadStatus.PLANNED } }),
    ]);
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'load',
      entityId: loadId,
      before: { status: LoadStatus.TENDERED },
      after: { status: LoadStatus.PLANNED, cancelledTenderId: tender.id },
    });
    return { cancelled: true };
  }

  /** Public read for the carrier-facing page. Lazily expires overdue tenders. */
  async getByToken(token: string) {
    const tender = await this.prisma.tender.findUnique({
      where: { token },
      include: {
        carrier: { select: { name: true } },
        tenant: { select: { name: true } },
        load: {
          select: {
            loadNumber: true,
            status: true,
            notes: true,
            mode: true,
            shipments: {
              select: {
                shipmentNumber: true,
                weightKg: true,
                volumeM3: true,
                palletCount: true,
                plannedPickupEarly: true,
                plannedPickupLate: true,
                plannedDeliveryEarly: true,
                plannedDeliveryLate: true,
                originLocation: { select: { name: true, city: true, state: true } },
                destinationLocation: { select: { name: true, city: true, state: true } },
              },
            },
            route: {
              select: {
                totalDistanceKm: true,
                stops: {
                  orderBy: { sequence: 'asc' },
                  select: {
                    sequence: true,
                    type: true,
                    plannedArrivalEarly: true,
                    plannedArrivalLate: true,
                    location: { select: { name: true, city: true, state: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!tender) throw new NotFoundException('Unknown tender link');

    if (tender.status === TenderStatus.PENDING && tender.expiresAt < new Date()) {
      await this.prisma.$transaction([
        this.prisma.tender.update({
          where: { id: tender.id },
          data: { status: TenderStatus.EXPIRED },
        }),
        this.prisma.load.update({
          where: { id: tender.loadId },
          data: { status: LoadStatus.PLANNED },
        }),
      ]);
      tender.status = TenderStatus.EXPIRED;
    }

    // Public payload: no tenant ids, no internal identifiers beyond what the carrier needs.
    // Explicit projection (rule 10) — enough context for the carrier to price the decision:
    // offered rate, equipment/mode, weight/volume/pallets, pickup & delivery windows,
    // origin/destination and the stop sequence. Decimals are converted to numbers.
    const load = tender.load;
    const shipments = load.shipments;
    const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

    return {
      status: tender.status,
      shipper: tender.tenant.name,
      carrier: tender.carrier.name,
      message: tender.message,
      expiresAt: tender.expiresAt,
      // Offered rate the carrier is being asked to accept — read from the FROZEN tender
      // snapshot (offeredAmount), never the live load cost, so a later recompute of the
      // load never changes an offer already sent.
      offeredRate: num(tender.offeredAmount),
      offeredCurrency: tender.offeredCurrency,
      load: {
        loadNumber: load.loadNumber,
        status: load.status,
        notes: load.notes,
        mode: load.mode, // equipment / transport mode (FTL/LTL/PARCEL)
        totalDistanceKm: load.route?.totalDistanceKm ?? null,
        shipments: shipments.map((s) => ({
          shipmentNumber: s.shipmentNumber,
          weightKg: num(s.weightKg),
          volumeM3: num(s.volumeM3),
          palletCount: s.palletCount,
          plannedPickupEarly: s.plannedPickupEarly,
          plannedPickupLate: s.plannedPickupLate,
          plannedDeliveryEarly: s.plannedDeliveryEarly,
          plannedDeliveryLate: s.plannedDeliveryLate,
          origin: s.originLocation
            ? { name: s.originLocation.name, city: s.originLocation.city, state: s.originLocation.state }
            : null,
          destination: s.destinationLocation
            ? {
                name: s.destinationLocation.name,
                city: s.destinationLocation.city,
                state: s.destinationLocation.state,
              }
            : null,
        })),
        route: {
          totalDistanceKm: load.route?.totalDistanceKm ?? null,
          stops:
            load.route?.stops.map((st) => ({
              sequence: st.sequence,
              type: st.type,
              plannedArrivalEarly: st.plannedArrivalEarly,
              plannedArrivalLate: st.plannedArrivalLate,
              location: st.location,
            })) ?? [],
        },
      },
    };
  }

  /** Public response from the carrier (accept / decline). */
  async respond(token: string, accept: boolean, declineReason?: string) {
    const tender = await this.prisma.tender.findUnique({ where: { token } });
    if (!tender) throw new NotFoundException('Unknown tender link');
    if (tender.status !== TenderStatus.PENDING) {
      throw new BadRequestException(`Tender already ${tender.status.toLowerCase()}`);
    }
    if (tender.expiresAt < new Date()) {
      throw new BadRequestException('Tender has expired');
    }

    const load = await this.prisma.load.findUniqueOrThrow({ where: { id: tender.loadId } });

    await this.prisma.$transaction([
      this.prisma.tender.update({
        where: { id: tender.id },
        data: {
          status: accept ? TenderStatus.ACCEPTED : TenderStatus.DECLINED,
          declineReason: accept ? null : declineReason,
          respondedAt: new Date(),
        },
      }),
      // Acceptance keeps the load TENDERED (dispatch is now allowed);
      // a decline returns it to the planning pool.
      ...(accept
        ? [
            this.prisma.load.update({
              where: { id: load.id },
              data: { carrierId: tender.carrierId },
            }),
          ]
        : [
            this.prisma.load.update({
              where: { id: load.id },
              data: { status: LoadStatus.PLANNED },
            }),
          ]),
      this.prisma.trackingEvent.create({
        data: {
          tenantId: tender.tenantId,
          loadId: load.id,
          type: TrackingEventType.PLANNED,
          message: accept
            ? `Tender accepted by carrier`
            : `Tender declined by carrier${declineReason ? `: ${declineReason}` : ''}`,
        },
      }),
    ]);

    await this.audit.log({
      tenantId: tender.tenantId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'tender',
      entityId: tender.id,
      before: { status: TenderStatus.PENDING },
      after: { status: accept ? TenderStatus.ACCEPTED : TenderStatus.DECLINED },
    });
    await this.webhooks.emit(tender.tenantId, accept ? 'tender.accepted' : 'tender.declined', {
      loadId: load.id,
      loadNumber: load.loadNumber,
      tenderId: tender.id,
      carrierId: tender.carrierId,
      ...(declineReason ? { declineReason } : {}),
    });

    if (!accept) {
      await this.domainEvents.emit(
        tender.tenantId,
        'tender.declined',
        { type: 'load', id: load.id },
        { loadId: load.id, loadNumber: load.loadNumber, carrierId: tender.carrierId, tenderId: tender.id },
      );
      await this.advanceChain(tender.id);
    }

    return { status: accept ? TenderStatus.ACCEPTED : TenderStatus.DECLINED };
  }
}
