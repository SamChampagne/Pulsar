import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, LoadStatus, TenderStatus, TrackingEventType } from '@pulsar/shared';
import { randomBytes } from 'node:crypto';
import { OwnershipService } from '../../../prisma/ownership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
import { WebhooksService } from '../../../core/integrations/webhooks.service';

export interface CreateTenderInput {
  carrierId?: string;
  message?: string;
  expiresInHours?: number;
}

const tenderInclude = {
  carrier: { select: { id: true, code: true, name: true, email: true } },
} as const;

@Injectable()
export class TendersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogsService,
    private readonly webhooks: WebhooksService,
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
  async create(tenantId: string, userId: string, loadId: string, input: CreateTenderInput) {
    const load = await this.prisma.load.findFirst({ where: { id: loadId, tenantId } });
    if (!load) throw new NotFoundException('Load not found');
    if (load.status !== LoadStatus.PLANNED) {
      throw new BadRequestException('Only PLANNED loads can be tendered');
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
          token: randomBytes(24).toString('base64url'),
          message: input.message,
          expiresAt: new Date(Date.now() + expiresInHours * 3600 * 1000),
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

    // TODO(phase-next): email the link to tender.carrier.email once an email channel exists.
    return { ...tender, responseUrl: this.link(tender.token) };
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
            shipments: { select: { shipmentNumber: true, weightKg: true, palletCount: true } },
            route: {
              select: {
                totalDistanceKm: true,
                stops: {
                  orderBy: { sequence: 'asc' },
                  select: {
                    sequence: true,
                    type: true,
                    plannedArrivalAt: true,
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
    return {
      status: tender.status,
      shipper: tender.tenant.name,
      carrier: tender.carrier.name,
      message: tender.message,
      expiresAt: tender.expiresAt,
      load: tender.load,
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

    return { status: accept ? TenderStatus.ACCEPTED : TenderStatus.DECLINED };
  }
}
