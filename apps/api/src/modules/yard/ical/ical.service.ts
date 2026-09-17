import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { buildIcs, DockAppointmentStatus, MODULE_KEYS } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../../prisma/tenant-modules-cache.service';

const HORIZON_DAYS = 90;

/**
 * Partner-facing dock-appointment calendar feed.
 *
 * The feed token is a plain capability secret (rule 10:
 * `randomBytes(24).toString('base64url')`) stored in `TenantModule.settings`
 * for the `yard` module under `icalToken` — the same "no new entity" pattern
 * as `Customer.portalToken` elsewhere, but living in the settings JSON blob
 * instead of a dedicated column since it is module-scoped, not row-scoped.
 * Rotating (calling generate again) simply overwrites the stored token,
 * invalidating the previous URL.
 */
@Injectable()
export class YardIcalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
  ) {}

  private async yardModuleId(): Promise<string> {
    const mod = await this.prisma.moduleDefinition.findUnique({
      where: { key: MODULE_KEYS.YARD },
      select: { id: true },
    });
    if (!mod) throw new NotFoundException('Yard module is not registered');
    return mod.id;
  }

  /** POST /yard/ical-token (perm yard.manage) — (re)generates the tenant's feed token. */
  async generateToken(tenantId: string): Promise<{ token: string }> {
    const moduleId = await this.yardModuleId();
    const token = randomBytes(24).toString('base64url');
    const existing = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      select: { settings: true },
    });
    const merged = {
      ...((existing?.settings ?? {}) as Record<string, unknown>),
      icalToken: token,
    };
    await this.prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      update: { settings: merged as Prisma.InputJsonValue },
      create: { tenantId, moduleId, enabled: false, settings: merged as Prisma.InputJsonValue },
    });
    this.modulesCache.invalidate(tenantId);
    return { token };
  }

  /**
   * Resolves the tenant owning `token`, re-checking module activation (rule 15
   * — this public route bypasses ModulesGuard). Throws NotFoundException for
   * any failure mode (unknown token, disabled row, disabled module) so a
   * caller can never distinguish "wrong token" from "module off".
   */
  private async resolveTenant(token: string): Promise<string> {
    const moduleId = await this.yardModuleId();
    const row = await this.prisma.tenantModule.findFirst({
      where: { moduleId, settings: { path: ['icalToken'], equals: token } },
      select: { tenantId: true, enabled: true },
    });
    if (!row || !row.enabled) throw new NotFoundException('Unknown feed');
    const enabledKeys = await this.modulesCache.getEnabledKeys(row.tenantId);
    if (!enabledKeys.has(MODULE_KEYS.YARD)) throw new NotFoundException('Unknown feed');
    return row.tenantId;
  }

  /**
   * GET /public/ical/yard/:token — dock appointments over the next 90 days.
   * Projection is explicit (rule 10): no tenantId, no internal ids, no
   * geometry/history — only what a partner needs to see the appointment on
   * their own calendar.
   */
  async buildFeed(token: string): Promise<string> {
    const tenantId = await this.resolveTenant(token);
    const now = new Date();
    const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

    const appointments = await this.prisma.dockAppointment.findMany({
      where: {
        tenantId,
        windowStart: { gte: now, lte: horizon },
        status: { notIn: [DockAppointmentStatus.CANCELLED, DockAppointmentStatus.NO_SHOW] },
      },
      orderBy: { windowStart: 'asc' },
      include: {
        spot: { select: { code: true } },
        carrier: { select: { name: true } },
        visits: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { trailerRef: true, trailer: { select: { unitNumber: true } } },
        },
      },
    });

    const events = appointments.map((a) => {
      const trailer = a.visits[0]?.trailer?.unitNumber ?? a.visits[0]?.trailerRef ?? undefined;
      const descriptionLines = [
        a.carrier?.name ? `Transporteur : ${a.carrier.name}` : undefined,
        trailer ? `Remorque : ${trailer}` : undefined,
        a.reference ? `Référence : ${a.reference}` : undefined,
      ].filter((line): line is string => Boolean(line));
      return {
        uid: `dock-appointment-${a.appointmentNumber}@pulsar`,
        start: a.windowStart,
        end: a.windowEnd,
        summary: a.spot?.code
          ? `RDV quai ${a.appointmentNumber} — ${a.spot.code}`
          : `RDV quai ${a.appointmentNumber}`,
        location: a.spot?.code,
        description: descriptionLines.length ? descriptionLines.join('\n') : undefined,
      };
    });

    return buildIcs(events, { prodId: '-//Pulsar//Yard iCal//FR', calName: 'Rendez-vous de quai' });
  }
}
