-- Explicit NOT NULL matters: a SQL CHECK accepts UNKNOWN as well as TRUE.
ALTER TABLE "service_part_usages" ADD CONSTRAINT "service_part_return_reason_required"
CHECK ("returnMovementId" IS NULL OR ("returnReason" IS NOT NULL AND length(trim("returnReason")) > 0));
