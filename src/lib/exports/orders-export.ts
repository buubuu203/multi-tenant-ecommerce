import { listOrders } from "../order-queries";
import { formatCsvAmount, formatCsvTimestamp } from "../csv";
import type { ExportTable } from "./products-export";

/**
 * Orders export rows for one tenant.
 *
 * Built on listOrders(), the SAME query the Tenant Admin orders page uses,
 * so every column here is a field that admin already displays on screen —
 * no new exposure, and no second definition of subtotal/total to drift
 * from the UI's.
 *
 * Deliberately NOT included: anything from Payment beyond the business
 * status and provider the orders page already shows. No providerOrderId,
 * no providerTransactionId, no providerMetadata, no webhook payload, no
 * bank account number. listOrders() does not select them, so they are not
 * merely omitted from the CSV — they never reach this code.
 *
 * Customer name, email and phone, and the shipping snapshot, are included
 * because the orders page already renders all of them for this tenant's
 * own orders; a merchant needs them to actually fulfil and deliver.
 *
 * PERSONAL DATA, and the reason this matters more here than on the page:
 * these columns carry customer name, email, phone and full shipping
 * address. On screen that data stays inside the app's authorization
 * boundary — every read goes through requireTenantAdmin() and is scoped to
 * one tenant. A downloaded CSV does not: once it is on a laptop or in an
 * email it is governed by nothing but whoever holds the file.
 *
 * So the export UI tells the merchant that explicitly (see
 * tenant-admin/orders/page.tsx), and anyone ADDING a column here should
 * ask whether it belongs in a file that leaves the app. Nothing beyond
 * what the orders page already displays should be added without that
 * question being answered — and never a payment, provider or auth field,
 * which listOrders() does not select in the first place.
 */
export const ORDER_EXPORT_HEADERS = [
  "order_id",
  "created_at",
  "order_status",
  "payment_method",
  "payment_status",
  "payment_provider",
  "shipping_method",
  "customer_name",
  "customer_email",
  "customer_phone",
  "shipping_address",
  "shipping_ward",
  "shipping_district",
  "shipping_city",
  "shipping_note",
  "item_count",
  "items",
  "subtotal_vnd",
  "shipping_amount_vnd",
  "total_vnd",
] as const;

/**
 * listOrders() is paginated for the UI. An export needs every order, so
 * this walks the pages rather than asking for one enormous page — the page
 * size is a deliberate ceiling on how much is held in memory at once, and
 * a hard page cap stops a pathological dataset from looping forever.
 */
const EXPORT_PAGE_SIZE = 200;
const MAX_PAGES = 500;

export async function buildOrdersExport(tenantId: string): Promise<ExportTable> {
  if (!tenantId.trim()) {
    return { headers: ORDER_EXPORT_HEADERS, rows: [] };
  }

  const rows: ExportTable["rows"] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { orders } = await listOrders(tenantId, { page, pageSize: EXPORT_PAGE_SIZE });
    if (orders.length === 0) {
      break;
    }

    for (const order of orders) {
      // One cell summarising the lines, so an order stays one row. Newlines
      // inside it are escaped by the CSV layer, so a spreadsheet shows a
      // multi-line cell rather than broken rows.
      const items = order.items
        .map((item) => {
          const label = item.combinationLabel ? ` (${item.combinationLabel})` : "";
          return `${item.quantity} x ${item.productName}${label} @ ${formatCsvAmount(item.unitPrice)}`;
        })
        .join("\n");

      rows.push([
        order.id,
        formatCsvTimestamp(order.createdAt),
        order.status,
        order.paymentMethod,
        order.paymentStatus ?? "",
        order.paymentProvider ?? "",
        order.shippingMethodName ?? "",
        order.customer.name,
        order.customer.email,
        order.customer.phone,
        order.shippingAddress,
        order.shippingWard,
        order.shippingDistrict,
        order.shippingCity,
        order.shippingNote ?? "",
        order.itemCount,
        items,
        formatCsvAmount(order.subtotal),
        formatCsvAmount(order.shippingAmount),
        formatCsvAmount(order.total),
      ]);
    }

    if (orders.length < EXPORT_PAGE_SIZE) {
      break;
    }
  }

  return { headers: ORDER_EXPORT_HEADERS, rows };
}
