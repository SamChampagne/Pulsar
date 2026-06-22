import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  BidStatus,
  CustomFieldEntity,
  InviteStatus,
  MODULE_KEYS,
  RateType,
  RfpStatus,
  canTransitionBid,
  canTransitionRfp,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { randomBytes } from 'node:crypto';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { CustomFieldsService } from '../../core/custom-fields/custom-fields.service';
import { EmailService } from '../../core/email/email.service';
import { ModuleSettingsService } from '../../core/module-registry/module-settings.service';
import { OwnershipService } from '../../prisma/ownership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SequencesService } from '../../prisma/sequences.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { RatesService } from '../transportation/rates/rates.service';
import { AddLaneDto } from './dto/add-lane.dto';
import { AwardDto } from './dto/award.dto';
import { CreateRfpDto } from './dto/create-rfp.dto';
import { InviteDto } from './dto/invite.dto';
import { UpdateRfpDto } from './dto/update-rfp.dto';

export interface RfpListQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ProcurementService {
  private readonly logger = new Logger(ProcurementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: SequencesService,
    private readonly ownership: OwnershipService,
    private readonly audit: AuditLogsService,
    private readonly email: EmailService,
    private readonly rates: RatesService,
    private readonly modulesCache: TenantModulesCacheService,
    private readonly moduleSettings: ModuleSettingsService,
    private readonly customFields: CustomFieldsService,
  ) {}

  // ---------------------------------------------------------------------------
  // RFP CRUD
  // ---------------------------------------------------------------------------

  async listRfps(tenantId: string, query?: RfpListQuery) {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 25;
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where = {
      tenantId,
      ...(query?.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.rfp.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { lanes: true, bids: true, invites: true } },
        },
      }),
      this.prisma.rfp.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async getRfp(tenantId: string, id: string) {
    const rfp = await this.prisma.rfp.findFirst({
      where: { id, tenantId },
      include: {
        lanes: { include: { award: true } },
        invites: {
          select: { id: true, carrierId: true, status: true, sentAt: true, respondedAt: true },
        },
        bids: true,
      },
    });
    if (!rfp) throw new NotFoundException('RFP not found');

    // Bid/Award/RfpInvite carry only carrierId (no Prisma relation), and RfpLane
    // only laneId — but the web detail page consumes nested `carrier`/`lane`
    // objects on a flat shape. Enrich by batch-loading the referenced rows
    // (tenant-scoped) and mapping client-side rather than adding schema relations.
    const awards = rfp.lanes.flatMap((l) => (l.award ? [l.award] : []));
    const carrierIds = [
      ...new Set([
        ...rfp.bids.map((b) => b.carrierId),
        ...rfp.invites.map((i) => i.carrierId),
        ...awards.map((a) => a.carrierId),
      ]),
    ];
    const laneIds = [...new Set(rfp.lanes.map((l) => l.laneId))];
    const [carriers, lanes] = await Promise.all([
      this.prisma.carrier.findMany({
        where: { tenantId, id: { in: carrierIds } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.lane.findMany({
        where: { tenantId, id: { in: laneIds } },
        include: {
          originLocation: { select: { id: true, code: true, name: true, city: true } },
          destinationLocation: { select: { id: true, code: true, name: true, city: true } },
        },
      }),
    ]);
    const carrierMap = new Map(carriers.map((c) => [c.id, c]));
    const laneMap = new Map(lanes.map((l) => [l.id, l]));

    return {
      ...rfp,
      rfpLanes: rfp.lanes.map((l) => ({ ...l, lane: laneMap.get(l.laneId) ?? null })),
      invites: rfp.invites.map((i) => ({ ...i, carrier: carrierMap.get(i.carrierId) ?? null })),
      bids: rfp.bids.map((b) => ({ ...b, carrier: carrierMap.get(b.carrierId) ?? null })),
      awards: awards.map((a) => ({ ...a, carrier: carrierMap.get(a.carrierId) ?? null })),
    };
  }

  async createRfp(tenantId: string, userId: string, dto: CreateRfpDto) {
    const customData = await this.customFields.validateValues(
      'procurement', tenantId, CustomFieldEntity.RFP, dto.customData, { partial: false },
    );
    const rfpNumber = await this.sequences.nextNumber(tenantId, 'rfp');
    const rfp = await this.prisma.rfp.create({
      data: {
        tenantId,
        rfpNumber,
        title: dto.title,
        description: dto.description ?? null,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        status: RfpStatus.DRAFT,
        createdById: userId,
        ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'rfp',
      entityId: rfp.id,
      after: { rfpNumber: rfp.rfpNumber, title: rfp.title, status: rfp.status },
    });
    return rfp;
  }

  async updateRfp(tenantId: string, id: string, dto: UpdateRfpDto) {
    await this.assertRfpExists(tenantId, id);
    const customData = await this.customFields.validateValues(
      'procurement', tenantId, CustomFieldEntity.RFP, dto.customData, { partial: true },
    );
    const data = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.deadline !== undefined
        ? { deadline: dto.deadline ? new Date(dto.deadline) : null }
        : {}),
      ...(customData !== undefined ? { customData: customData as Prisma.InputJsonValue } : {}),
    };
    await this.prisma.rfp.updateMany({ where: { id, tenantId }, data });
    return this.prisma.rfp.findFirst({ where: { id, tenantId } });
  }

  // ---------------------------------------------------------------------------
  // Lanes
  // ---------------------------------------------------------------------------

  async addLane(tenantId: string, rfpId: string, dto: AddLaneDto) {
    await this.assertRfpExists(tenantId, rfpId);
    await this.ownership.assertOwned('lane', dto.laneId, tenantId);
    return this.prisma.rfpLane.create({
      data: {
        tenantId,
        rfpId,
        laneId: dto.laneId,
        mode: (dto.mode as any) ?? null,
        volumeEstimate: dto.volumeEstimate ?? null,
      },
    });
  }

  async removeLane(tenantId: string, rfpId: string, rfpLaneId: string) {
    const lane = await this.prisma.rfpLane.findFirst({
      where: { id: rfpLaneId, rfpId, tenantId },
    });
    if (!lane) throw new NotFoundException('RFP lane not found');
    await this.prisma.rfpLane.delete({ where: { id: rfpLaneId } });
    return { removed: true };
  }

  // ---------------------------------------------------------------------------
  // Invites
  // ---------------------------------------------------------------------------

  async invite(tenantId: string, rfpId: string, dto: InviteDto) {
    const rfp = await this.assertRfpExists(tenantId, rfpId);
    await this.ownership.assertOwned('carrier', dto.carrierId, tenantId);

    const token = randomBytes(24).toString('base64url');
    const invite = await this.prisma.rfpInvite.create({
      data: {
        tenantId,
        rfpId,
        carrierId: dto.carrierId,
        token,
        status: InviteStatus.SENT,
      },
    });

    // Email best-effort (fire and forget)
    const carrier = await this.prisma.carrier.findUnique({
      where: { id: dto.carrierId },
      select: { email: true, name: true },
    });
    if (carrier?.email) {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      this.email
        .send({
          to: carrier.email,
          subject: `Invitation to bid — RFP ${rfp.rfpNumber ?? rfp.id} — ${tenant.name}`,
          html: [
            `<p>${tenant.name} has invited you to submit a bid for RFP <strong>${rfp.title}</strong>.</p>`,
            rfp.deadline ? `<p>Deadline: ${new Date(rfp.deadline).toUTCString()}</p>` : '',
            `<p>Use your unique bid link to submit your offer.</p>`,
          ].join('\n'),
          text: `${tenant.name} has invited you to bid on RFP ${rfp.title}.`,
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `RFP invite email failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    return invite;
  }

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  async transitionRfp(tenantId: string, id: string, target: RfpStatus, userId?: string) {
    const rfp = await this.assertRfpExists(tenantId, id);
    if (!canTransitionRfp(rfp.status as RfpStatus, target)) {
      throw new BadRequestException(`Cannot transition RFP from ${rfp.status} to ${target}`);
    }
    const result = await this.prisma.rfp.updateMany({
      where: { id, tenantId, status: rfp.status },
      data: { status: target },
    });
    if (result.count === 0) throw new ConflictException('RFP status was modified concurrently');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'rfp',
      entityId: id,
      before: { status: rfp.status },
      after: { status: target },
    });
    return this.getRfp(tenantId, id);
  }

  async transitionBid(
    tenantId: string,
    rfpId: string,
    bidId: string,
    target: BidStatus,
    userId?: string,
  ) {
    const bid = await this.prisma.bid.findFirst({
      where: { id: bidId, rfpId, tenantId },
    });
    if (!bid) throw new NotFoundException('Bid not found');
    if (!canTransitionBid(bid.status as BidStatus, target)) {
      throw new BadRequestException(`Cannot transition bid from ${bid.status} to ${target}`);
    }
    const result = await this.prisma.bid.updateMany({
      where: { id: bidId, tenantId, status: bid.status },
      data: { status: target },
    });
    if (result.count === 0) throw new ConflictException('Bid status was modified concurrently');
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'bid',
      entityId: bidId,
      before: { status: bid.status },
      after: { status: target },
    });
    return this.prisma.bid.findUniqueOrThrow({ where: { id: bidId } });
  }

  // ---------------------------------------------------------------------------
  // Award
  // ---------------------------------------------------------------------------

  async award(tenantId: string, userId: string, rfpId: string, dto: AwardDto) {
    const rfp = await this.assertRfpExists(tenantId, rfpId);

    // A lane can only be awarded while the RFP is being evaluated. Awarding from
    // any other status would leave the RFP in an inconsistent state (the
    // EVALUATION→AWARDED auto-transition below would silently fail).
    if (rfp.status !== RfpStatus.EVALUATION) {
      throw new BadRequestException('RFP must be in EVALUATION to award a lane');
    }

    // Validate rfpLane belongs to this rfp+tenant
    const rfpLane = await this.prisma.rfpLane.findFirst({
      where: { id: dto.rfpLaneId, rfpId, tenantId },
    });
    if (!rfpLane) throw new NotFoundException('RFP lane not found');

    // Validate bid belongs to rfpLane and is in an awardable status
    const bid = await this.prisma.bid.findFirst({
      where: {
        id: dto.bidId,
        rfpLaneId: dto.rfpLaneId,
        tenantId,
        status: { in: [BidStatus.SUBMITTED, BidStatus.SHORTLISTED] },
      },
    });
    if (!bid) throw new NotFoundException('Bid not found or not in an awardable status');
    if (!canTransitionBid(bid.status as BidStatus, BidStatus.ACCEPTED)) {
      throw new BadRequestException(`Cannot accept a bid in status ${bid.status}`);
    }

    // Atomic award: claim the winning bid (status-guarded), demote any previous
    // winner on the lane (re-award must never leave two ACCEPTED bids), and
    // (re)create the lane award — all in one transaction so a failed claim can
    // never leave an Award pointing at a non-accepted bid.
    let newAward = await this.prisma.$transaction(async (tx) => {
      const bidClaim = await tx.bid.updateMany({
        where: { id: dto.bidId, tenantId, status: { in: [BidStatus.SUBMITTED, BidStatus.SHORTLISTED] } },
        data: { status: BidStatus.ACCEPTED },
      });
      if (bidClaim.count === 0) throw new ConflictException('Offre déjà traitée');

      // Re-award correction: a previous winner is ACCEPTED (terminal in the SM);
      // demote it to REJECTED so the lane carries exactly one accepted bid.
      await tx.bid.updateMany({
        where: { rfpLaneId: dto.rfpLaneId, tenantId, status: BidStatus.ACCEPTED, id: { not: dto.bidId } },
        data: { status: BidStatus.REJECTED },
      });

      return tx.award.upsert({
        where: { rfpLaneId: dto.rfpLaneId },
        create: {
          tenantId,
          rfpLaneId: dto.rfpLaneId,
          carrierId: bid.carrierId,
          bidId: dto.bidId,
          awardedById: userId,
        },
        update: {
          carrierId: bid.carrierId,
          bidId: dto.bidId,
          awardedById: userId,
          awardedAt: new Date(),
        },
      });
    });

    // Optionally create a Rate from the winning bid (falls back to per-tenant setting).
    const procSettings = await this.moduleSettings.resolve(tenantId, 'procurement');
    const shouldCreateRate = dto.createRate ?? (procSettings.awardCreatesRateByDefault as boolean);
    if (shouldCreateRate) {
      try {
        if (!Object.values(RateType).includes(bid.rateType as RateType)) {
          throw new BadRequestException('rateType invalide');
        }
        const rate = await this.rates.create(tenantId, {
          name: `Award RFP ${rfp.rfpNumber ?? rfp.id}`,
          rateType: bid.rateType as RateType,
          baseAmount: Number(bid.amount),
          currency: bid.currency,
          carrierId: bid.carrierId,
          laneId: rfpLane.laneId,
          validFrom: bid.validFrom ? bid.validFrom.toISOString() : undefined,
          validTo: bid.validTo ? bid.validTo.toISOString() : undefined,
        });
        // Store rateId on award
        newAward = await this.prisma.award.update({
          where: { id: newAward.id },
          data: { rateId: rate.id },
        });
      } catch (err) {
        this.logger.warn(
          `Award rate creation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'rfp-award',
      entityId: rfp.id,
      after: { rfpLaneId: dto.rfpLaneId, bidId: dto.bidId, carrierId: bid.carrierId },
    });

    // Best-effort: if all lanes are awarded, transition RFP to AWARDED
    try {
      const [totalLanes, totalAwards] = await this.prisma.$transaction([
        this.prisma.rfpLane.count({ where: { rfpId, tenantId } }),
        this.prisma.award.count({
          where: { tenantId, rfpLane: { rfpId } },
        }),
      ]);
      if (totalLanes > 0 && totalLanes === totalAwards) {
        await this.transitionRfp(tenantId, rfpId, RfpStatus.AWARDED, userId);
      }
    } catch (err) {
      this.logger.warn(
        `Auto-AWARDED transition failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return newAward;
  }

  // ---------------------------------------------------------------------------
  // Routing guide
  // ---------------------------------------------------------------------------

  routingGuide(tenantId: string) {
    return this.prisma.award.findMany({
      where: {
        tenantId,
        rfpLane: { rfp: { status: { not: RfpStatus.CANCELLED } } },
      },
      include: {
        rfpLane: {
          include: {
            rfp: { select: { id: true, rfpNumber: true, title: true, status: true } },
          },
        },
      },
      orderBy: { awardedAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Public: resolve invite by token (rule-15 module re-check)
  // ---------------------------------------------------------------------------

  async getInviteByToken(token: string) {
    const invite = await this.prisma.rfpInvite.findUnique({
      where: { token },
      include: {
        rfp: {
          include: {
            tenant: { select: { id: true, name: true } },
            lanes: true,
          },
        },
      },
    });
    if (!invite) throw new NotFoundException('Unknown invite link');

    // Rule-15: re-check that procurement module is enabled for the tenant
    const enabled = await this.modulesCache.getEnabledKeys(invite.rfp.tenantId);
    if (!enabled.has(MODULE_KEYS.PROCUREMENT)) {
      throw new NotFoundException('Unknown invite link');
    }

    // Fetch lane details separately (no @relation in schema for RfpLane→Lane)
    const laneIds = invite.rfp.lanes.map((rl) => rl.laneId);
    const laneRecords = await this.prisma.lane.findMany({
      where: { id: { in: laneIds } },
      select: {
        id: true,
        originCity: true,
        originState: true,
        originCountry: true,
        destinationCity: true,
        destinationState: true,
        destinationCountry: true,
      },
    });
    const laneMap = new Map(laneRecords.map((l) => [l.id, l]));

    // Rule-10: return only safe public projection (no tenantId, no internal refs)
    return {
      rfp: {
        title: invite.rfp.title,
        description: invite.rfp.description,
        deadline: invite.rfp.deadline,
        status: invite.rfp.status,
      },
      shipper: invite.rfp.tenant.name,
      lanes: invite.rfp.lanes.map((rl) => {
        const lane = laneMap.get(rl.laneId);
        return {
          rfpLaneId: rl.id,
          mode: rl.mode,
          volumeEstimate: rl.volumeEstimate,
          originSummary: buildLocationSummary(
            lane?.originCity ?? null,
            lane?.originState ?? null,
            lane?.originCountry ?? null,
          ),
          destinationSummary: buildLocationSummary(
            lane?.destinationCity ?? null,
            lane?.destinationState ?? null,
            lane?.destinationCountry ?? null,
          ),
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Public: submit bid via token
  // ---------------------------------------------------------------------------

  async submitBidByToken(
    token: string,
    dto: {
      rfpLaneId: string;
      rateType: string;
      amount: number;
      currency?: string;
      transitDays?: number;
      notes?: string;
      validFrom?: string;
      validTo?: string;
    },
  ) {
    const invite = await this.prisma.rfpInvite.findUnique({
      where: { token },
      include: { rfp: { select: { id: true, tenantId: true, status: true } } },
    });
    if (!invite) throw new NotFoundException('Unknown invite link');

    // Rule-15: module re-check
    const enabled = await this.modulesCache.getEnabledKeys(invite.rfp.tenantId);
    if (!enabled.has(MODULE_KEYS.PROCUREMENT)) {
      throw new NotFoundException('Unknown invite link');
    }

    if (invite.rfp.status !== RfpStatus.OPEN) {
      throw new BadRequestException('RFP is not currently accepting bids');
    }

    // Validate rfpLaneId belongs to the rfp
    const rfpLane = await this.prisma.rfpLane.findFirst({
      where: { id: dto.rfpLaneId, rfpId: invite.rfpId, tenantId: invite.tenantId },
    });
    if (!rfpLane) throw new NotFoundException('RFP lane not found');

    const settings = await this.moduleSettings.resolve(invite.tenantId, 'procurement');
    if (settings.bidUniqueness === 'SINGLE') {
      // Replace any existing non-terminal bid for this (lane, carrier).
      await this.prisma.bid.deleteMany({
        where: {
          rfpLaneId: dto.rfpLaneId,
          carrierId: invite.carrierId,
          tenantId: invite.tenantId,
          status: { in: [BidStatus.SUBMITTED, BidStatus.SHORTLISTED] },
        },
      });
    }

    await this.prisma.bid.create({
      data: {
        tenantId: invite.tenantId,
        rfpId: invite.rfpId,
        rfpLaneId: dto.rfpLaneId,
        carrierId: invite.carrierId,
        rateType: dto.rateType as any,
        amount: dto.amount,
        currency: dto.currency ?? 'CAD',
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validTo: dto.validTo ? new Date(dto.validTo) : null,
        transitDays: dto.transitDays ?? null,
        notes: dto.notes ?? null,
        status: BidStatus.SUBMITTED,
      },
    });

    // Mark invite RESPONDED (best-effort, claim)
    this.prisma.rfpInvite
      .updateMany({
        where: { id: invite.id, status: InviteStatus.SENT },
        data: { status: InviteStatus.RESPONDED, respondedAt: new Date() },
      })
      .catch(() => {
        /* best-effort */
      });

    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertRfpExists(tenantId: string, id: string) {
    const rfp = await this.prisma.rfp.findFirst({
      where: { id, tenantId },
    });
    if (!rfp) throw new NotFoundException('RFP not found');
    return rfp;
  }
}

function buildLocationSummary(
  city: string | null,
  state: string | null,
  country: string | null,
): string {
  return [city, state, country].filter(Boolean).join(', ');
}
