-- Order Lookup by phone/name (V1): supporting indexes for the new
-- tenant-scoped lookup queries in order-queries.ts. Purely additive,
-- non-destructive — two new indexes, no column/table changes.
BEGIN;

CREATE INDEX "customers_tenantId_phone_idx" ON "customers"("tenantId", "phone");
CREATE INDEX "customers_tenantId_name_idx" ON "customers"("tenantId", "name");

COMMIT;
