# Tenant Admin user guide — scope and maintenance

The merchant-facing guide lives at `/tenant-admin/help`. This note is for
whoever maintains it.

**It is a usage guide and nothing else.** Not a CMS, not a support chat,
not an accounting system, not a carrier system, not a CRM, not a VAT or
e-invoice system, and not a payment settlement system. It describes the
application as it is.

## Entry point

One `?` link in the shared Tenant Admin header (`layout.tsx`), beside the
account controls, with the accessible name `Mở hướng dẫn sử dụng`.

Because it lives in the shell, it appears on every admin page. **No page
adds its own help button**, and a test walks every `page.tsx` to enforce
that. It is a plain link — no popup, no modal, no client state, works
without JavaScript — and it is deliberately **not** in the sidebar: the
sidebar lists destinations, this is help.

## Authorization and data

Authorized by `requireTenantAdmin()` like every other admin route, purely
to keep the guide behind the same door as the pages it describes.

**It reads no tenant data.** A test asserts the page contains no
`getScopedDb`, `prisma`, `findMany`, `findFirst` or raw query. The
content is static, so there is nothing tenant-specific to leak. Marked
`noindex`.

## Content source

`src/app/tenant-admin/help/help-content.ts` — typed `HelpSection[]`,
rendered by the page. Data rather than a long JSX block so coverage can
be checked structurally.

Each section carries: `purpose`, `canDo`, `workflow`, `concepts`,
`limits`, and either a real `route` or a `routeNote` saying where the
feature is found.

## Coverage, enforced by tests

- Every destination in `AdminNav` must have a section. The navigation is
  **parsed**, not hard-coded, so adding a nav entry without a section
  fails the suite.
- Every `route` on a section must exist in the real route tree, so a
  renamed or deleted page fails rather than leaving a dead link.
- Every section must have a non-empty `limits`. A section cannot be added
  with its limitations left blank.

Three routes have no nav entry and no section of their own, by design —
`products/new` has its own section anyway, while
`orders/[orderId]/print` and `customers/[customerId]` are explained
inside the print and customer sections.

## The limitations are the point

Tests pin the wording for each area so it cannot quietly soften:

| Area                | Must say                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Print               | Not a VAT or e-invoice; the shipping note is not a carrier waybill; no tracking number                                   |
| Orders              | A fulfilled order does not prove pickup, delivery or COD collection                                                      |
| Overview, Customers | Order value is _không phải doanh thu đã thu_                                                                             |
| Payment operations  | Not accounting, not bank reconciliation, never claims money arrived                                                      |
| Payments            | Switching provider replaces the stored configuration                                                                     |
| Shipping            | No carrier integration, tracking, label or delivery estimate                                                             |
| CSV import          | All-or-nothing; legacy products without a SKU cannot be updated                                                          |
| Customers           | No edit, delete or merge                                                                                                 |
| Catalog             | Existing images are **not** retroactively converted to WebP                                                              |
| Analytics           | Order value is _KHÔNG phải doanh thu đã thu được_; a succeeded payment _không chứng minh tiền đã về tài khoản ngân hàng_ |
| Fulfillment         | An internal queue only — no carrier, tracking, pickup or delivery                                                        |

## What the guide must never contain

Asserted by test: tenant, customer or payment identifiers; provider
metadata, payloads, digests or signatures; any email address; any
external URL; links to Platform Admin; internal vocabulary such as
_webhook_, _schema_, _SQL_ or _Prisma_; and any "coming soon" wording.

No support email, phone number, chat link or SLA is invented — there is
no such flow in this application, so the guide says to contact your
system administrator and nothing more.

## Editing rules

1. Describe only what the application currently does. Verify against the
   route before writing.
2. A limitation belongs in `limits` of the relevant section. Never omit
   one to make the guide read more smoothly.
3. Write for a shop operator, in Vietnamese, without implementation
   vocabulary.
4. Adding a page to the navigation means adding a section; the suite will
   remind you.

## Not verified

**Browser QA has not been run.** The guide and the `?` icon have never
been rendered, so nothing about their appearance at desktop, 375px or
414px is confirmed. The structural checks cover headings, landmarks, link
names and the absence of forced-nowrap and images — not how any of it
looks.
