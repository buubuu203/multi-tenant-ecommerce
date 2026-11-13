import { listCustomers, CUSTOMER_PAGE_SIZE } from '../customer-queries';
import { formatCsvTimestamp } from '../csv';

/**
 * Customer export rows for one tenant.
 *
 * The export registry used to say customers were deliberately absent,
 * because "order count / lifetime value would require inventing a
 * definition". Both are now defined once in customer-queries.ts and
 * reused here, so the CSV and the screen cannot disagree:
 *
 *   orders       — every order, cancelled included.
 *   order_value  — items + shipping, EXCLUDING cancelled orders. Not
 *                  revenue: it includes orders nobody has paid for.
 *
 * Carries PII — name, phone, email. The UI warns before download; this
 * module simply does not add anything beyond those already-visible
 * fields. No payment metadata, no webhook payload, no internal payment
 * or tenant id.
 */

export const CUSTOMER_EXPORT_HEADERS = [
  'customer_name',
  'phone',
  'email',
  'orders',
  'cancelled_orders',
  'order_value_vnd',
  'first_order_at',
  'last_order_at',
  'latest_order_status',
  'latest_payment_status',
  'possible_duplicate_phone',
] as const;

/** Bounded: a tenant cannot pull an unlimited export in one request. */
export const CUSTOMER_EXPORT_MAX_ROWS = 5000;

export async function buildCustomersExport(tenantId: string): Promise<{
  headers: readonly string[];
  rows: (string | number | null | undefined)[][];
}> {
  if (!tenantId.trim()) {
    return { headers: CUSTOMER_EXPORT_HEADERS, rows: [] };
  }

  const rows: (string | number | null | undefined)[][] = [];
  const maxPages = Math.ceil(CUSTOMER_EXPORT_MAX_ROWS / CUSTOMER_PAGE_SIZE);

  // Pages the same deterministic ordering the list uses, so the export is
  // reproducible and bounded rather than one unbounded query.
  for (let page = 1; page <= maxPages; page++) {
    const { rows: customers } = await listCustomers(tenantId, { page });
    if (customers.length === 0) break;

    for (const customer of customers) {
      rows.push([
        customer.name,
        customer.phone,
        customer.email,
        customer.orderCount,
        customer.cancelledCount,
        customer.orderValue,
        formatCsvTimestamp(customer.firstOrderAt),
        formatCsvTimestamp(customer.lastOrderAt),
        customer.latestOrderStatus ?? '',
        customer.latestPaymentStatus ?? '',
        customer.possibleDuplicatePhone ? 'yes' : 'no',
      ]);
      if (rows.length >= CUSTOMER_EXPORT_MAX_ROWS)
        return { headers: CUSTOMER_EXPORT_HEADERS, rows };
    }

    if (customers.length < CUSTOMER_PAGE_SIZE) break;
  }

  return { headers: CUSTOMER_EXPORT_HEADERS, rows };
}
