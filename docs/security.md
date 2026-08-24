# Security: Tenant Isolation & Access Control

Status: **Approved** (defense-in-depth model and layer responsibilities). Specific
code (Prisma extension implementation) is **Proposed** pending the walking skeleton,
and will be updated to "Approved" once built and tested — see
[decisions.md](decisions.md) #002.

## Threat Model

A Tenant A user must never be able to read or modify Tenant B's products, orders, or
customers — including if they manipulate URLs, API parameters, resource IDs, or
request bodies. This must hold even if one layer of defense has a bug.

## Defense-in-Depth Layers

```text
Request
  ↓
1. Tenant identification (middleware, from domain)     — candidate only, not trusted
  ↓
2. Authentication (Clerk)                               — confirms who the user is
  ↓
3. Authorization                                        — confirms user.tenantId
                                                            matches resolved tenant
  ↓
4. Server-side tenant context                           — verified tenantId passed
                                                            explicitly through server
                                                            logic; never read from
                                                            client-supplied input
  ↓
5. Database access (scoped Prisma client)                — every query automatically
                                                            filtered by tenantId
  ↓
Result: cross-tenant resource request → 0 rows → 404, never partial/leaked data
```

**Golden rule**: `tenantId` is only ever derived server-side from the authenticated
session (layers 1–3). It is never trusted if it appears in a URL, query string,
hidden form field, or JSON body.

## Database Access Strategy (Proposed implementation, Approved requirement)

Requirement (Approved): it must be structurally difficult for a developer to write a
query that accidentally returns rows across tenants — this cannot depend on everyone
remembering to add `where: { tenantId }` by hand.

### Prisma version check (done 2026-08-24)

Verified against Prisma 7 (current stable as of this writing):
- Prisma's older `$use` middleware API has been **removed** in Prisma 7.
- **Prisma Client Extensions** (`$extends`, specifically the `query` extension
  component) are the current, supported mechanism for intercepting and modifying
  queries, and are stable (GA since Prisma 4.16). This document's approach is built
  on extensions, not middleware.

### Proposed approach

- Feature code never imports the raw `PrismaClient` directly. Instead it imports a
  pre-built, tenant-scoped client (e.g. `getScopedDb(tenantId)`), built using a
  Prisma Client Extension's `query` component, which automatically injects
  `where: { tenantId }` (or an `AND` condition for existing filters) into every query
  issued through it.
- This makes the "safe" path (`db.order.findMany()`) also the *only* path — there is
  no unscoped `findMany()` available for feature code to accidentally call.
- Raw/unscoped Prisma access is confined to a small, clearly-named `platformDb`
  client, used only inside Platform Admin routes (see
  [multi-tenancy.md](multi-tenancy.md#platform-admin-vs-tenant-admin)). This makes
  cross-tenant access visible in code review rather than incidental.

### Future hardening option (Proposed, not required for V1)

Postgres **Row-Level Security (RLS)** can enforce tenant filtering at the database
level itself, independent of application code — a true additional layer, since even
a bug in the Prisma extension could not bypass it. This is a recognized, current
pattern (Prisma Client Extension sets a session variable via `SET LOCAL
app.tenant_id` inside a transaction; Postgres policies enforce filtering using that
variable). Not implemented in V1 to avoid additional complexity before the core
platform is proven; recorded here as a strong candidate for hardening once real
tenant data is at stake.

## Testing Strategy

Automated **negative-access tests** are a required part of "done" for every API
endpoint that touches tenant data:

```text
Given: Tenant A and Tenant B each have their own product/order/customer records
When: an authenticated Tenant A user requests a Tenant B resource by ID
       (via URL param, query string, or body)
Then: the response must be 404 (not found) — never 200 with data, never a 403 that
       confirms the resource exists
```

This test pattern will be built as a reusable test helper so it is cheap to apply
uniformly, rather than a one-off effort per feature.

## Platform Admin Access (see also multi-tenancy.md)

Platform Admin cross-tenant access is intentional and necessary, but must be
explicit, not a byproduct of missing scoping:
- Separate `platformDb` client, used only in `/platform-admin/*` routes
- UI always shows which tenant is currently being viewed/managed
- Authorization check for Platform Admin routes is `role === "platform_admin"`,
  entirely separate from the Tenant Admin `user.tenantId` check
