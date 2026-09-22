import { ConflictException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { connectedOperationsSettings, hrAvailabilityDate } from '@pulsar/shared';

export interface SchedulingSlot {
  assigneeUserId: string | null;
  scheduledAt: Date | null;
  plannedMinutes: number | null;
}
/** Used by EVERY job writer under lockBusinessTenant, not only the planning UI. */
export async function assertServiceSlot(
  tx: Prisma.TransactionClient,
  tenantId: string,
  slot: SchedulingSlot,
  jobId?: string,
) {
  if (!slot.assigneeUserId || !slot.scheduledAt || !slot.plannedMinutes) return;
  const end = new Date(slot.scheduledAt.getTime() + slot.plannedMinutes * 60000);
  const conflicts = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM service_jobs WHERE "tenantId" = ${tenantId} AND "assigneeUserId" = ${slot.assigneeUserId}
    AND status IN ('PLANNED', 'IN_PROGRESS') AND id <> ${jobId ?? ''} AND "plannedMinutes" IS NOT NULL
    AND "scheduledAt" < ${end} AND "scheduledAt" + "plannedMinutes" * interval '1 minute' > ${slot.scheduledAt}
    LIMIT 1`;
  if (conflicts.length)
    throw new ConflictException('Cette personne a déjà une intervention sur ce créneau.');
  const enabled = await tx.tenantModule.findFirst({
    where: { tenantId, enabled: true, module: { key: 'hr' } },
    select: { tenantId: true },
  });
  if (!enabled) {
    if (
      jobId &&
      (await tx.serviceJob.count({
        where: {
          tenantId,
          id: jobId,
          OR: [{ skillRequirements: { some: {} } }, { workCenterId: { not: null } }],
        },
      }))
    )
      throw new ConflictException(
        'Réactivez RH pour vérifier les exigences de cette intervention.',
      );
    return;
  }
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { settings: true },
  });
  const timeZone = connectedOperationsSettings(
    (tenant.settings as Record<string, unknown>).connectedOperations,
  ).timeZone;
  const from = new Date(hrAvailabilityDate(slot.scheduledAt.toISOString(), timeZone));
  const to = new Date(hrAvailabilityDate(new Date(end.getTime() - 1).toISOString(), timeZone));
  const employee = await tx.hrEmployee.findFirst({
    where: { tenantId, userId: slot.assigneeUserId },
    select: { id: true, active: true },
  });
  if (employee && !employee.active)
    throw new ConflictException('Le dossier RH de cette personne est inactif.');
  if (
    employee &&
    (await tx.hrLeaveRequest.count({
      where: {
        tenantId,
        employeeId: employee.id,
        status: 'APPROVED',
        startDate: { lte: to },
        endDate: { gte: from },
      },
    }))
  )
    throw new ConflictException('Ce créneau est incompatible avec une absence approuvée.');
  if (!jobId) return;
  const job = await tx.serviceJob.findFirstOrThrow({
    where: { tenantId, id: jobId },
    select: { workCenterId: true, skillRequirements: { select: { skillId: true } } },
  });
  if (
    job.workCenterId &&
    !(await tx.workCenter.findFirst({ where: { tenantId, id: job.workCenterId, isActive: true } }))
  )
    throw new ConflictException('Poste de référence inactif.');
  const wcSkills = job.workCenterId
    ? await tx.workCenterSkillRequirement.findMany({
        where: { tenantId, workCenterId: job.workCenterId },
        select: { skillId: true },
      })
    : [];
  const skillIds = [...new Set([...job.skillRequirements, ...wcSkills].map((r) => r.skillId))];
  if (!skillIds.length) return;
  const qualified = employee
    ? await tx.hrQualification.findMany({
        where: {
          tenantId,
          employeeId: employee.id,
          skillId: { in: skillIds },
          skill: { active: true },
          status: 'ACTIVE',
          validFrom: { lte: from },
          OR: [{ expiresOn: null }, { expiresOn: { gte: to } }],
        },
        select: { skillId: true },
      })
    : [];
  if (new Set(qualified.map((q) => q.skillId)).size !== skillIds.length)
    throw new ConflictException('Les qualifications requises ne couvrent pas tout ce créneau.');
}
