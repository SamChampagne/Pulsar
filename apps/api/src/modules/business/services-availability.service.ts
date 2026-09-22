import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuthUser,
  HrAvailabilityResult,
  PERMISSIONS,
  calendarDate,
  hrAvailabilityDate,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { ServicesAvailabilityDto } from './services-availability.dto';

@Injectable()
export class ServicesAvailabilityService {
  constructor(
    private readonly db: PrismaService,
    private readonly modules: TenantModulesCacheService,
  ) {}

  async check(user: AuthUser, dto: ServicesAvailabilityDto): Promise<HrAvailabilityResult> {
    // Recheck here too: future internal consumers must not bypass the HTTP guard.
    if (
      !user.permissions.includes(PERMISSIONS.SERVICES.READ) ||
      !user.permissions.includes(PERMISSIONS.HR.AVAILABILITY_READ)
    )
      throw new ForbiddenException('Le contrôle requiert services.read et hr.availability.read.');
    const enabled = await this.modules.getEnabledKeys(user.tenantId);
    if (!enabled.has('services') || !enabled.has('hr'))
      throw new ForbiddenException('Activez Services et Ressources humaines pour ce contrôle.');
    let dates: string[];
    try {
      dates = dto.items.map((item) => hrAvailabilityDate(item.scheduledAt, dto.timeZone));
    } catch {
      throw new BadRequestException('Horaire réel (1900–2199) et fuseau IANA valide requis.');
    }
    const tenantId = user.tenantId;
    return this.db.$transaction(
      async (tx) => {
        // One consistent read snapshot; no locks, writes or HR snapshots on the service job.
        const ids = [...new Set(dto.items.map((item) => item.userId))];
        const people = await tx.user.findMany({
          where: {
            tenantId,
            id: { in: ids },
            agentServiceFor: { none: {} },
            NOT: { email: 'service-account@pulsar.local' },
          },
          select: { id: true, status: true },
        });
        if (people.length !== ids.length) throw new NotFoundException('Personne introuvable.');
        const employees = await tx.hrEmployee.findMany({
          where: { tenantId, userId: { in: ids } },
          select: { id: true, userId: true, active: true },
        });
        const byUser = new Map(employees.map((e) => [e.userId, e]));
        const active = new Set(people.filter((p) => p.status === 'ACTIVE').map((p) => p.id));
        const checks = dto.items.flatMap((item, i) => {
          const employee = byUser.get(item.userId);
          if (!employee?.active || !active.has(item.userId)) return [];
          const day = calendarDate(dates[i]);
          return [{ employeeId: employee.id, startDate: { lte: day }, endDate: { gte: day } }];
        });
        const leaves = checks.length
          ? await tx.hrLeaveRequest.findMany({
              where: { tenantId, status: 'APPROVED', OR: checks },
              select: { employeeId: true, startDate: true, endDate: true },
            })
          : [];
        return {
          timeZone: dto.timeZone,
          checkedAt: new Date().toISOString(),
          items: dto.items.map((item, i) => {
            const employee = byUser.get(item.userId),
              date = dates[i];
            const absent =
              employee &&
              leaves.some(
                (leave) =>
                  leave.employeeId === employee.id &&
                  leave.startDate.toISOString().slice(0, 10) <= date &&
                  leave.endDate.toISOString().slice(0, 10) >= date,
              );
            return {
              date,
              state: !active.has(item.userId)
                ? 'USER_UNAVAILABLE'
                : !employee
                  ? 'EMPLOYEE_NOT_LINKED'
                  : !employee.active
                    ? 'EMPLOYEE_INACTIVE'
                    : absent
                      ? 'ABSENT'
                      : 'NO_APPROVED_ABSENCE',
            };
          }),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
