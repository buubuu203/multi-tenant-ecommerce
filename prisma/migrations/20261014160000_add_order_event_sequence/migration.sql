-- Deterministic ordering for the append-only order audit history.
--
-- Why: order_events."createdAt" is written at millisecond precision, so two
-- events recorded close together — two inside one updateOrderStatus
-- transaction, for instance — frequently share an identical timestamp. The
-- timeline query broke that tie on "id", a random UUID, so the audit log
-- could be read back in an order that never occurred.
--
-- Additive and minimal: one column plus one index. No existing column is
-- altered or dropped, and no row is deleted.
--
-- Historical rows: SERIAL assigns values to existing rows during the add,
-- in physical table order. For an append-only table that is insertion order,
-- so pre-existing events keep a correct relative ordering and stay readable.
ALTER TABLE "order_events" ADD COLUMN "sequence" SERIAL;

CREATE INDEX "order_events_tenantId_orderId_sequence_idx"
  ON "order_events"("tenantId", "orderId", "sequence");
