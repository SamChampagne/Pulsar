CREATE TYPE "HrSkillKind" AS ENUM ('COMPETENCE', 'AUTHORIZATION');
CREATE TYPE "HrQualificationStatus" AS ENUM ('ACTIVE', 'REVOKED');
ALTER TABLE "support_cases" ADD COLUMN "assigneeUserId" TEXT, ADD COLUMN "dueDate" DATE;
CREATE TABLE "hr_skills" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "code" TEXT NOT NULL,
 "name" TEXT NOT NULL, "kind" "HrSkillKind" NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "hr_qualifications" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
 "skillId" TEXT NOT NULL, "validFrom" DATE NOT NULL, "expiresOn" DATE,
 "reference" TEXT NOT NULL, "status" "HrQualificationStatus" NOT NULL DEFAULT 'ACTIVE',
 "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, "revokedById" TEXT, "revokedAt" TIMESTAMP(3),
 "revokeReason" TEXT, "operationKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 CONSTRAINT "hr_qualification_dates" CHECK ("expiresOn" IS NULL OR "expiresOn" >= "validFrom"),
 CONSTRAINT "hr_qualification_revocation" CHECK (
   ("status" = 'ACTIVE' AND "revokedAt" IS NULL AND "revokedById" IS NULL AND "revokeReason" IS NULL)
   OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND length(trim("revokeReason")) > 0))
);
CREATE TABLE "work_center_skill_requirements" (
 "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "workCenterId" TEXT NOT NULL, "skillId" TEXT NOT NULL
);
CREATE UNIQUE INDEX "hr_skills_tenantId_id_key" ON "hr_skills"("tenantId", "id");
CREATE UNIQUE INDEX "hr_skills_tenantId_code_key" ON "hr_skills"("tenantId", "code");
CREATE INDEX "hr_qualifications_tenantId_employeeId_skillId_status_idx" ON "hr_qualifications"("tenantId", "employeeId", "skillId", "status");
CREATE UNIQUE INDEX "hr_qualifications_tenantId_operationKey_key" ON "hr_qualifications"("tenantId", "operationKey");
CREATE UNIQUE INDEX "work_center_skill_requirements_tenantId_workCenterId_skillI_key" ON "work_center_skill_requirements"("tenantId", "workCenterId", "skillId");
CREATE UNIQUE INDEX "work_centers_tenantId_id_key" ON "work_centers"("tenantId", "id");
ALTER TABLE "hr_skills" ADD CONSTRAINT "hr_skills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_qualifications" ADD CONSTRAINT "hr_qualifications_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "hr_employees"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_qualifications" ADD CONSTRAINT "hr_qualifications_tenantId_skillId_fkey" FOREIGN KEY ("tenantId", "skillId") REFERENCES "hr_skills"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_qualifications" ADD CONSTRAINT "hr_qualifications_tenantId_createdById_fkey" FOREIGN KEY ("tenantId", "createdById") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "hr_qualifications" ADD CONSTRAINT "hr_qualifications_tenantId_revokedById_fkey" FOREIGN KEY ("tenantId", "revokedById") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "work_center_skill_requirements" ADD CONSTRAINT "work_center_skill_requirements_tenantId_workCenterId_fkey" FOREIGN KEY ("tenantId", "workCenterId") REFERENCES "work_centers"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_center_skill_requirements" ADD CONSTRAINT "work_center_skill_requirements_tenantId_skillId_fkey" FOREIGN KEY ("tenantId", "skillId") REFERENCES "hr_skills"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_tenantId_assigneeUserId_fkey" FOREIGN KEY ("tenantId", "assigneeUserId") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
