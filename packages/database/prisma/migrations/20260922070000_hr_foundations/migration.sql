CREATE TYPE "HrLeaveStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "HrLeaveKind" AS ENUM ('TIME_OFF', 'UNAVAILABLE', 'OTHER');
CREATE TABLE "hr_teams" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "hr_teams_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "hr_employees" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "code" TEXT NOT NULL,
 "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL, "jobTitle" TEXT NOT NULL DEFAULT '',
 "teamId" TEXT, "userId" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "hr_employees_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "hr_leave_requests" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
 "number" TEXT NOT NULL, "kind" "HrLeaveKind" NOT NULL,
 "startDate" DATE NOT NULL, "endDate" DATE NOT NULL, "note" TEXT NOT NULL DEFAULT '',
 "status" "HrLeaveStatus" NOT NULL DEFAULT 'DRAFT', "createdById" TEXT NOT NULL,
 "operationKey" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "hr_leave_requests_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "hr_leave_dates_valid" CHECK ("endDate" >= "startDate" AND "endDate" - "startDate" <= 365)
);
CREATE TABLE "hr_leave_events" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "leaveId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
 "action" TEXT NOT NULL, "note" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "hr_leave_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_teams_tenantId_active_idx" ON "hr_teams"("tenantId", "active");
CREATE UNIQUE INDEX "hr_teams_tenantId_id_key" ON "hr_teams"("tenantId", "id");
CREATE UNIQUE INDEX "hr_teams_tenantId_code_key" ON "hr_teams"("tenantId", "code");
CREATE INDEX "hr_employees_tenantId_teamId_active_idx" ON "hr_employees"("tenantId", "teamId", "active");
CREATE UNIQUE INDEX "hr_employees_tenantId_id_key" ON "hr_employees"("tenantId", "id");
CREATE UNIQUE INDEX "hr_employees_tenantId_code_key" ON "hr_employees"("tenantId", "code");
CREATE UNIQUE INDEX "hr_employees_tenantId_userId_key" ON "hr_employees"("tenantId", "userId");
CREATE INDEX "hr_leave_requests_tenantId_employeeId_startDate_endDate_idx" ON "hr_leave_requests"("tenantId", "employeeId", "startDate", "endDate");
CREATE INDEX "hr_leave_requests_tenantId_status_idx" ON "hr_leave_requests"("tenantId", "status");
CREATE UNIQUE INDEX "hr_leave_requests_tenantId_id_key" ON "hr_leave_requests"("tenantId", "id");
CREATE UNIQUE INDEX "hr_leave_requests_tenantId_number_key" ON "hr_leave_requests"("tenantId", "number");
CREATE UNIQUE INDEX "hr_leave_requests_tenantId_operationKey_key" ON "hr_leave_requests"("tenantId", "operationKey");
CREATE INDEX "hr_leave_events_tenantId_leaveId_createdAt_idx" ON "hr_leave_events"("tenantId", "leaveId", "createdAt");
ALTER TABLE "hr_teams" ADD CONSTRAINT "hr_teams_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_tenantId_teamId_fkey" FOREIGN KEY ("tenantId", "teamId") REFERENCES "hr_teams"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_tenantId_employeeId_fkey" FOREIGN KEY ("tenantId", "employeeId") REFERENCES "hr_employees"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_tenantId_createdById_fkey" FOREIGN KEY ("tenantId", "createdById") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "hr_leave_events" ADD CONSTRAINT "hr_leave_events_tenantId_leaveId_fkey" FOREIGN KEY ("tenantId", "leaveId") REFERENCES "hr_leave_requests"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_leave_events" ADD CONSTRAINT "hr_leave_events_tenantId_actorId_fkey" FOREIGN KEY ("tenantId", "actorId") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
