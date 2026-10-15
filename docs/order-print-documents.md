# Order print documents

Three print-friendly documents a tenant admin can produce for an order.
They are **operational paperwork**, not legal or tax documents.

Printing uses the browser: **Print**, or **Save as PDF** from the print
dialog. There is no PDF engine, no carrier integration, and no API call to
anyone.

## The three documents

| Document          | For                                         | Carries prices?                              |
| ----------------- | ------------------------------------------- | -------------------------------------------- |
| **Order summary** | The customer, or the merchant's own records | Yes — line totals, subtotal, shipping, total |
| **Packing slip**  | Whoever picks and packs the parcel          | **No**                                       |
| **Shipping note** | Handing the parcel to a courier             | COD amount only                              |

Reached from each order's detail disclosure in Tenant Admin:

```
/tenant-admin/orders/<orderId>/print?document=order-summary
/tenant-admin/orders/<orderId>/print?document=packing-slip
/tenant-admin/orders/<orderId>/print?document=shipping-note
```

## What these documents are not

- **The order summary is not a VAT or electronic tax invoice.** It says so
  on the page. No tax identifiers, no invoice series, no e-invoice signing.
- **The packing slip is not a tax invoice.**
- **The shipping note is not an official carrier label.** It carries no
  barcode, no tracking number and no carrier name, because none exists: the
  schema has no tracking field and there is no carrier integration.

E-invoice and carrier integrations would be separate features. Nothing
here makes a compliance claim.

## Fields

All of it comes from existing columns. Nothing is invented.

| Shown                         | Source                                                     | When missing                                           |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Store name                    | `Branding.storeName`, falling back to `Tenant.name`        | Always has a value                                     |
| Store logo                    | `Branding.logoUrl`                                         | Omitted; the name is always printed beside it          |
| Order reference               | `Order.id` — already what order lookup asks a customer for | Always present                                         |
| Order date                    | `Order.createdAt`                                          | Always present                                         |
| Customer name / phone / email | `Customer`                                                 | Always present                                         |
| Delivery address              | `Order.shippingAddress` + ward + district + city           | Joined, blanks skipped                                 |
| Delivery note                 | `Order.shippingNote`                                       | Line omitted                                           |
| Line items                    | `OrderItem` + product/variant                              | —                                                      |
| Variant label                 | Built from the variant's options                           | Omitted for a simple product                           |
| SKU                           | `ProductVariant.sku`                                       | Shown as `—`                                           |
| Unit price / line total       | `OrderItem.price` snapshot × quantity                      | —                                                      |
| Subtotal / shipping / total   | Computed: line totals + `Order.shippingAmount`             | —                                                      |
| Currency                      | Fixed `VND`                                                | There is no currency column                            |
| Payment method / status       | `Order.paymentMethod`, `Payment.status`                    | Status shows "not recorded" for pre-Payment-row orders |
| Shipping method               | `Order.shippingMethodName`                                 | Shows "not recorded"                                   |
| COD amount                    | The total, **only** when the payment method is `cod`       | Shows "Nothing to collect — already paid"              |

There is **no billing address** — the schema stores one shipping address.
There is **no tracking number**, and none is fabricated.

## Never printed

Enforced by a hand-written projection — Prisma rows never reach a
component, and a test serializes the whole projection and searches it:

`Payment.providerMetadata` (raw provider/webhook payload),
`providerOrderId`, `providerTransactionId`, `failureReason`, `tenantId`,
`customerId`, `productVariantId`, and `OrderEvent.sequence`.

## Authorization and privacy

Every print route calls `requireTenantAdmin()` **before** reading the
order, and reads through tenant-scoped access. A nonexistent order and
another tenant's order return the **same** not-found, so a tenant cannot
probe for the existence of another's order id. An unknown `document` value
is a 404, never a fallback to some other document.

Pages are `force-dynamic` with `revalidate = 0`: they render a customer's
name, phone and address and are never cached.

**Opening or printing a document changes nothing.** No order field is
written and no order event is recorded — viewing a document is not
something that happened to the order. A test compares the order row
byte-for-byte, `updatedAt` included, around rendering all three.

## Print behaviour

- A4 with 12mm margins; smaller sheets scale the same layout.
- The admin top bar, sidebar and the page's own buttons do not print.
- Table headers repeat on every page of a long order.
- Line-item rows and the totals block never split across a page.
- Vietnamese names, addresses and long SKUs wrap rather than clip.
- Black on white; no meaning carried by colour alone.
- Link URLs are not appended to the printed text.

### Known limitations

- **Page size is fixed to A4** in CSS. A5 and thermal rolls print the same
  layout scaled by the browser; they are not separately tuned.
- Whether the browser prints background colours and images is a per-browser
  print setting this app cannot control. The documents are designed to read
  correctly with backgrounds off.
- A logo is fetched by the browser at print time. If it fails, the store
  name still prints; no placeholder is substituted.
- Headers, footers and page numbers come from the browser's own print
  dialog, not from the document.
- Very long orders paginate but the per-page item count depends on the
  browser and paper size.

## Branding

The store name and logo come from existing branding. No upload, no media
conversion and no change to SVG-logo handling is part of this feature.
