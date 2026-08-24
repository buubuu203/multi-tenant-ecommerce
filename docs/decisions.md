# Architecture Decision Log

Each entry records a decision at the time it was made. Do not edit past entries to
reflect new thinking — add a new decision and mark the old one **Superseded**,
linking to the entry that replaces it.

Status values: **Proposed**, **Approved**, **Superseded**.

---

## Decision 001 — Shared application, shared database, multi-tenant

**Status:** Approved (2026-08-24)

Use one Next.js application and one PostgreSQL database to serve all tenants, with
tenant data separated by a `tenantId` column rather than per-tenant databases or
deployments.

**Why:** minimizes operational burden (one thing to build, deploy, monitor, upgrade)
at the target scale of ~50 tenants. Trade-off accepted: requires strict, consistently
enforced query scoping (see Decision 002).

---

## Decision 002 — Defense-in-depth tenant isolation

**Status:** Approved (2026-08-24)

Tenant isolation is enforced across five layers (domain-based identification,
authentication, authorization, verified server-side tenant context, and scoped
database access) rather than relying on any single layer, per
[security.md](security.md).

**Why:** a single point of failure (e.g. trusting a client-supplied tenant ID, or
relying only on middleware) is an unacceptable risk for a platform holding multiple
businesses' customer and order data.

---

## Decision 003 — Support platform subdomains and custom domains

**Status:** Approved (2026-08-24)

Tenants are reachable via a platform subdomain (`shop-a.yourplatform.com`) during
development/testing, and via a tenant-owned custom domain (`shop-a.com`) in
production. Both resolve to a tenant through the same middleware code path, backed
by different lookup tables (subdomain vs. domain mapping).

**Why:** subdomains are simple for testing and for tenants without their own domain
yet; custom domains are required for a credible white-label production offering.

---

## Decision 004 — V1 scope: physical products only

**Status:** Approved (2026-08-24)

V1 supports physical products only. Ticketing/events and other product types are
explicitly out of scope and deferred.

**Why:** keeps V1 scope achievable; physical products plus CSV import plus
COD/MoMo/Bank Transfer already represents a full commerce loop worth proving before
expanding product types.

---

## Decision 005 — Clerk as V1 authentication provider

**Status:** Approved (2026-08-24)

Use Clerk for Tenant Admin and Platform Admin authentication in V1.

**Why:** authentication/session security is high-risk to build in-house; Clerk is a
proven managed service that handles this correctly at low cost and low integration
effort. Buyer checkout does not require account creation in V1 (guest checkout).

**Note:** marked Approved as the V1 choice, not a permanent architectural
commitment — revisit only if Clerk's pricing or feature set becomes a blocker at
scale.

---

## Decision 006 — COD first, provider-based payment architecture

**Status:** Approved (2026-08-24)

Cash on Delivery is the first payment method implemented. The checkout/payment
architecture is designed as a provider-based system from the start, so that MoMo and
Bank Transfer can be added later without redesigning checkout.

**Why:** COD is the simplest to implement correctly and lets us validate the full
order flow quickly, while the provider-based design avoids costly rework when MoMo
and Bank Transfer are added.

---

## Decision 007 — Build a walking skeleton before commerce features

**Status:** Approved (2026-08-24)

Before implementing products, cart, checkout, or payments, build a minimal
end-to-end slice: tenant creation (Platform Admin), tenant branding edit (Tenant
Admin), and a storefront homepage that renders per-tenant branding resolved via
subdomain or custom domain.

**Why:** validates the hardest and most expensive-to-retrofit part of the
architecture — tenant resolution and isolation — before investing in features built
on top of it.

---

## Decision 008 — Prisma Client Extensions (not middleware) for query scoping

**Status:** Approved (2026-08-24)

Use Prisma Client Extensions (`$extends`, `query` component) to build a tenant-scoped
database client that automatically injects `tenantId` filtering into every query.
Postgres Row-Level Security is recorded as a future hardening option, not required
for V1.

**Why:** verified against current Prisma (v7) that the older `$use` middleware API
has been removed and Client Extensions are the current, stable, supported mechanism
for this pattern. Confirmed before implementation per explicit requirement to check
rather than assume API availability from older documentation.
