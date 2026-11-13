import { prisma } from "./prisma";

/**
 * The minimal capability recordOrderEventInTx() needs from a transaction
 * client: the ability to insert one order_events row.
 *
 * Typed structurally on purpose. Events are written from two different
 * transaction flavours — createOrder()/updateOrderStatus() run inside
 * getScopedDb()'s EXTENDED client, while markManualPaymentReceived() runs
 * inside the plain prisma client — and those two types are not assignable
 * to each other. Naming only what is used keeps one writer usable from
 * both instead of forcing a cast.
 */
type OrderEventTx = {
  orderEvent: {
    create(args: {
      data: {
        tenantId: string;
        orderId: string;
        type: OrderEventType;
        previousValue: string | null;
        newValue: string | null;
        summary: string;
        actorType: OrderEventActorType;
        actorId: string | null;
      };
    }): Promise<unknown>;
  };
};

// Order Audit History: the ONE place order timeline events are written and
// read. Append-only from application code — this module exports no update
// and no delete, and no Server Action wraps one, so nothing reachable from
// a browser can alter recorded history.
//
// IMPORTANT, and not overstated: this is APPLICATION-LEVEL append-only
// history. No database-level controls were added — no row-level security,
// no revoked DELETE grant, no immutability trigger. Anyone with direct
// database credentials can still modify or remove rows. Treat it as an
// operational timeline for merchants, not as tamper-proof evidence.
//
// Deliberately separate from PaymentEvent, which is not an audit log: that
// table makes provider webhooks idempotent and stores the raw payload.
// Nothing here stores a provider payload, signature, token, session id,
// account number or card data, and no summary contains customer name,
// email, phone or address.

export type OrderEventType =
  | "order_created"
  | "order_status_changed"
  | "payment_status_changed"
  | "inventory_released";

export type OrderEventActorType = "system" | "tenant_admin" | "platform_admin";

/**
 * Who caused a mutation, passed down from the authorized entry point.
 *
 * `id` is the acting Clerk user id where one exists — the same identifier
 * requirePlatformAdmin() already returns. It is never a token, a session
 * id or an email. System actions (guest checkout) carry no id.
 */
export type OrderEventActor =
  | { type: "system"; id?: undefined }
  | { type: "tenant_admin"; id?: string }
  | { type: "platform_admin"; id?: string };

/** The actor for anything the application does without a signed-in user. */
export const SYSTEM_ACTOR: OrderEventActor = { type: "system" };

export type RecordOrderEventInput = {
  tenantId: string;
  orderId: string;
  type: OrderEventType;
  previousValue?: string | null;
  newValue?: string | null;
  summary: string;
  actor: OrderEventActor;
};

/**
 * Appends one event, inside the caller's transaction.
 *
 * `tx` is required rather than optional on purpose: an event must commit or
 * roll back with the business mutation it describes, so a failed
 * transaction can never leave a timeline entry claiming something happened.
 * Callers that are not already in a transaction must open one.
 *
 * `orderEvent` is NOT in getScopedDb()'s model allowlist (same as `order`
 * and `orderItem`), so tenantId is passed explicitly here — the rule
 * order-queries.ts and order-mutations.ts already follow.
 *
 * The client cannot influence any field: type and summary are chosen by the
 * calling mutation, tenantId comes from trusted request context, actor
 * comes from the authorization helper, and createdAt is the database
 * default rather than anything supplied.
 */
export async function recordOrderEventInTx(
  tx: OrderEventTx,
  input: RecordOrderEventInput,
): Promise<void> {
  await tx.orderEvent.create({
    data: {
      tenantId: input.tenantId,
      orderId: input.orderId,
      type: input.type,
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      summary: input.summary,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
    },
  });
}

export type OrderTimelineEntry = {
  id: string;
  type: OrderEventType;
  previousValue: string | null;
  newValue: string | null;
  summary: string;
  actorType: OrderEventActorType;
  createdAt: Date;
};

/**
 * This order's timeline, oldest first.
 *
 * Scoped by tenantId AND orderId together, so another tenant's order id
 * returns an empty array exactly as an unknown id does — the caller cannot
 * tell the two apart, the same posture getOrderForCustomer() uses.
 *
 * actorId is deliberately NOT returned: the merchant-facing UI shows a role
 * label, and a Clerk user id on screen would be noise at best. It stays in
 * the database for operational lookup.
 */
export async function getOrderTimeline(
  tenantId: string,
  orderId: string,
): Promise<OrderTimelineEntry[]> {
  if (!tenantId.trim() || !orderId.trim()) {
    return [];
  }
  const events = await prisma.orderEvent.findMany({
    where: { tenantId, orderId },
    // Creation order, from the database-assigned sequence. NOT
    // createdAt: it is millisecond-precision and client-generated, so
    // events written close together can tie, and the old tiebreak on a
    // random UUID could reorder real history.
    orderBy: [{ sequence: "asc" }],
    select: {
      id: true,
      type: true,
      previousValue: true,
      newValue: true,
      summary: true,
      actorType: true,
      createdAt: true,
    },
  });
  return events;
}

/**
 * Timelines for several orders in ONE query, keyed by order id.
 *
 * The admin orders page renders up to 20 expandable order cards; asking
 * per card would be 20 round-trips, so this is the same
 * "constant number of queries, not one per row" rule
 * get-tenant-products.ts already follows for options and inventory.
 *
 * Scoped by tenantId AND the id list together, so an id belonging to
 * another tenant simply contributes no entry — the caller gets an empty
 * timeline for it, indistinguishable from an order with no activity.
 */
export async function getOrderTimelinesForOrders(
  tenantId: string,
  orderIds: string[],
): Promise<Map<string, OrderTimelineEntry[]>> {
  const byOrder = new Map<string, OrderTimelineEntry[]>();
  const ids = orderIds.filter((id) => id.trim().length > 0);
  if (!tenantId.trim() || ids.length === 0) {
    return byOrder;
  }

  const events = await prisma.orderEvent.findMany({
    where: { tenantId, orderId: { in: ids } },
    // Creation order, from the database-assigned sequence. NOT
    // createdAt: it is millisecond-precision and client-generated, so
    // events written close together can tie, and the old tiebreak on a
    // random UUID could reorder real history.
    orderBy: [{ sequence: "asc" }],
    select: {
      id: true,
      orderId: true,
      type: true,
      previousValue: true,
      newValue: true,
      summary: true,
      actorType: true,
      createdAt: true,
    },
  });

  for (const { orderId, ...entry } of events) {
    const existing = byOrder.get(orderId);
    if (existing) {
      existing.push(entry);
    } else {
      byOrder.set(orderId, [entry]);
    }
  }
  return byOrder;
}

/** Human label for an actor, for the admin timeline. */
export function actorLabel(actorType: OrderEventActorType): string {
  switch (actorType) {
    case "tenant_admin":
      return "Store admin";
    case "platform_admin":
      return "Platform admin";
    case "system":
      return "System";
  }
}

/** Human label for an event type, for the admin timeline. */
export function eventTypeLabel(type: OrderEventType): string {
  switch (type) {
    case "order_created":
      return "Order created";
    case "order_status_changed":
      return "Status changed";
    case "payment_status_changed":
      return "Payment updated";
    case "inventory_released":
      return "Stock released";
  }
}
