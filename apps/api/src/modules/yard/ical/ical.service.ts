import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { AuditAction, buildIcs, DockAppointmentStatus, MODULE_KEYS } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { AuditLogsService } from '../../../core/audit-logs/audit-logs.service';
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
 * invalidating the previous URL. `icalTokenRotatedAt` is stamped alongside it
 * so `getStatus` can report a real rotation date without ever exposing the
 * token itself (rule 10 — reload-safe status).
 */
@Injectable()
export class YardIcalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  private async yardModuleId(): Promise<string> {
    const mod = await this.prisma.moduleDefinition.findUnique({
      where: { key: MODULE_KEYS.YARD },
      select: { id: true },
    });
    if (!mod) throw new NotFoundException('Yard module is not registered');
    return mod.id;
  }

  /** Absolute public URL for a feed token, built from API_URL (rule: public API links come from config, never req.protocol/host). */
  buildPublicUrl(token: string): string {
    const apiUrl = this.config.get<string>('API_URL', 'http://localhost:3000').replace(/\/+$/, '');
    return `${apiUrl}/api/v1/public/ical/yard/${token}`;
  }

  /**
   * GET /yard/ical-token (perm yard.read) — reload-safe status. NEVER returns
   * the token or the URL (rule 10): a caller re-mounting the config page must
   * be able to tell whether a link already exists (to switch the button to
   * "Régénérer") without the token ever leaving the server twice.
   */
  async getStatus(tenantId: string): Promise<{ hasToken: boolean; rotatedAt?: string }> {
    const moduleId = await this.yardModuleId();
    const row = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      select: { settings: true },
    });
    const settings = (row?.settings ?? {}) as Record<string, unknown>;
    const hasToken = typeof settings.icalToken === 'string' && settings.icalToken.length > 0;
    if (!hasToken) return { hasToken: false };
    const rotatedAt =
      typeof settings.icalTokenRotatedAt === 'string' ? settings.icalTokenRotatedAt : undefined;
    return { hasToken: true, rotatedAt };
  }

  /**
   * POST /yard/ical-token (perm yard.manage) — (re)generates the tenant's feed
   * token. Audited (rule 6): the action distinguishes first-time creation from
   * rotation, the token itself is never logged.
   */
  async generateToken(tenantId: string, userId: string): Promise<{ token: string }> {
    const moduleId = await this.yardModuleId();
    const token = randomBytes(24).toString('base64url');
    const rotatedAt = new Date().toISOString();
    const existing = await this.prisma.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      select: { settings: true },
    });
    const existingSettings = (existing?.settings ?? {}) as Record<string, unknown>;
    const hadToken =
      typeof existingSettings.icalToken === 'string' && existingSettings.icalToken.length > 0;
    const merged = {
      ...existingSettings,
      icalToken: token,
      icalTokenRotatedAt: rotatedAt,
    };
    await this.prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId } },
      update: { settings: merged as Prisma.InputJsonValue },
      create: { tenantId, moduleId, enabled: false, settings: merged as Prisma.InputJsonValue },
    });
    this.modulesCache.invalidate(tenantId);
    await this.audit.log({
      tenantId,
      userId,
      action: hadToken ? AuditAction.UPDATE : AuditAction.CREATE,
      entityType: 'yard-ical-token',
      after: { rotated: hadToken, rotatedAt },
    });
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
