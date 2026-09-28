import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTenantAdminAuthorization } from "../src/lib/auth/require-tenant-admin";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

test("authorization: no hostname-resolved tenant fails closed", () => {
  const decision = resolveTenantAdminAuthorization({ role: "tenant_admin", tenantId: TENANT_A }, null);
  assert.equal(decision.authorized, false);
});

test("authorization: no Clerk session/metadata fails closed", () => {
  const decision = resolveTenantAdminAuthorization(undefined, TENANT_A);
  assert.equal(decision.authorized, false);
});

test("authorization: platform_admin role alone does not grant tenant_admin access", () => {
  const decision = resolveTenantAdminAuthorization({ role: "platform_admin" }, TENANT_A);
  assert.equal(decision.authorized, false);
});

test("authorization: tenant_admin with no tenantId in metadata fails closed", () => {
  const decision = resolveTenantAdminAuthorization({ role: "tenant_admin" }, TENANT_A);
  assert.equal(decision.authorized, false);
});

test("authorization: metadata.tenantId for a DIFFERENT tenant than the hostname resolves to is rejected", () => {
  // This is the core cross-tenant-access defense: a user with a valid
  // tenant_admin grant for tenant B must never be authorized on tenant A's
  // hostname just because they're logged in.
  const decision = resolveTenantAdminAuthorization({ role: "tenant_admin", tenantId: TENANT_B }, TENANT_A);
  assert.equal(decision.authorized, false);
});

test("authorization: matching role + tenantId + hostname-resolved tenant succeeds", () => {
  const decision = resolveTenantAdminAuthorization({ role: "tenant_admin", tenantId: TENANT_A }, TENANT_A);
  assert.equal(decision.authorized, true);
  if (decision.authorized) {
    assert.equal(decision.tenantId, TENANT_A);
  }
});
