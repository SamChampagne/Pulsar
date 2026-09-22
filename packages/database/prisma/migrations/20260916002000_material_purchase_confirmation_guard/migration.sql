-- CHECK must explicitly reject NULL (PostgreSQL otherwise accepts UNKNOWN).
ALTER TABLE "material_purchase_orders"
  DROP CONSTRAINT "material_purchase_confirmation_check",
  ADD CONSTRAINT "material_purchase_confirmation_check"
  CHECK (status <> 'CONFIRMED' OR (
    "confirmedAt" IS NOT NULL AND "supplierReference" IS NOT NULL
    AND length(trim("supplierReference")) > 0
  ));
