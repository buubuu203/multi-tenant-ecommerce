# Multi-Tenancy

Status: **Approved** (model and identification strategy). Implementation code does
not exist yet — this document describes intended behavior.

## Model

Shared application, shared PostgreSQL database. Every tenant-owned table (Product,
Order, Customer, etc.) carries a `tenantId` column. There is no per-tenant database
or schema. See [decisions.md](decisions.md) #001.

## Tenant Identification

Every incoming request is resolved to a tenant *before* any page or API logic runs,
using Next.js middleware:

1. Read the request's hostname.
2. If it matches the platform's subdomain pattern (`*.yourplatform.com`), extract the
   subdomain and look up the tenant by subdomain.
3. Otherwise, treat the hostname as a possible custom domain and look up the tenant
   in a `Domain` mapping table (`domain -> tenantId`).
4. If no tenant is found, serve a platform-level "not found" page (not a tenant page).
5. If found, attach the resolved `tenantId` to the request context for downstream use.

This applies uniformly to development subdomains (`shop-a.yourplatform.com`) and
production custom domains (`shop-a.com`) — same code path, same lookup pattern, just
a different table.

**Important**: this middleware step identifies a *candidate* tenant for rendering
purposes (branding, product catalog, etc.). It is **not** treated as sufficient
authorization for authenticated actions — see [security.md](security.md) for why and
how authenticated requests re-verify the tenant server-side.

## Tenant Isolation

Full detail in [security.md](security.md). Summary: identification (above) is one of
five layers; the layer that actually prevents cross-tenant data access is
server-side, on every database query, not the domain lookup.

## Platform Admin vs. Tenant Admin

Two distinct roles, not a permissions flag on one role:

- **Tenant Admin**: a user record that belongs to exactly one `tenantId`. All of
  their actions go through the tenant-scoped database client, which is incapable of
  returning another tenant's rows (see [security.md](security.md)).
- **Platform Admin**: a user record with no `tenantId` — a platform-level account
  (you). Platform Admin screens use a separate, explicitly-named database client and
  always require deliberately selecting which tenant is being viewed/managed
  (reflected in the URL and UI, e.g. `/platform-admin/tenants/shop-a/orders`). There
  is no "all tenants at once" default view that could accidentally mix data.

## Branding Per Tenant

Each tenant has branding data (name, logo, primary/secondary colors, and eventually
layout variation). The storefront renders using the tenant resolved by middleware.
Exact theming mechanism (CSS variables vs. per-tenant themes) is **Proposed**, to be
finalized during the walking skeleton — not yet decided.

## Open Questions (Proposed, not decided)

- Exact `Domain` table schema (verification flow for custom domains, DNS
  instructions for tenants) — to be designed during the walking skeleton.
- Whether a tenant can have multiple domains simultaneously (e.g. old + new domain
  during a migration) — not yet needed, deferred.
