import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAdminAccountView } from "../src/lib/auth/admin-account-view";

test("an unauthenticated visitor gets no account information at all", () => {
  // The account bar renders nothing on this result, so there is no email
  // and no sign-out control on the page for a visitor with no session.
  assert.deepEqual(resolveAdminAccountView(null), { signedIn: false });
  assert.deepEqual(resolveAdminAccountView(undefined), { signedIn: false });
});

test("a signed-in user's own primary email is shown", () => {
  const view = resolveAdminAccountView({
    primaryEmailAddress: { emailAddress: "admin@example.test" },
  });
  assert.deepEqual(view, { signedIn: true, email: "admin@example.test" });
});

test("a signed-in user with no email still gets the shell, so they can sign out", () => {
  // signedIn stays true: being stranded in an admin surface with no way
  // to leave is worse than a missing address.
  assert.deepEqual(resolveAdminAccountView({ primaryEmailAddress: null }), {
    signedIn: true,
    email: null,
  });
  assert.deepEqual(resolveAdminAccountView({}), { signedIn: true, email: null });
  assert.deepEqual(resolveAdminAccountView({ primaryEmailAddress: { emailAddress: "   " } }), {
    signedIn: true,
    email: null,
  });
});

test("the view carries nothing but the email — no metadata, tenant or session fields", () => {
  // Guards the privacy rule structurally rather than by inspection: even
  // when handed an object carrying role/tenantId/session data, nothing
  // but signedIn and email can come out the other side.
  const view = resolveAdminAccountView({
    primaryEmailAddress: { emailAddress: "admin@example.test" },
    // Extra fields a real Clerk user object carries, which must not pass through.
    ...({ publicMetadata: { role: "platform_admin", tenantId: "tenant-123" }, id: "user_abc" } as object),
  });
  assert.deepEqual(Object.keys(view).sort(), ["email", "signedIn"]);
});

// The remaining requirements are about what the DENIED path renders.
// This project's suite is node:test with no DOM or React renderer, so
// these are asserted against the source structure instead — which is
// where the original bug actually lived: the account controls were
// rendered inside the authorized branch, after the early return, so the
// denied path could never reach them.
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/**
 * Source with comments stripped, so these structural checks match real
 * code rather than prose that happens to mention the same identifiers.
 */
const readCode = (p: string) =>
  // Line comments FIRST, deliberately: a // comment in this codebase
  // mentions a path like "/tenant-admin/*", and stripping block comments
  // first treats that as an opening /* and eats everything up to the next
  // */ anywhere later in the file — which silently swallowed the very
  // code these assertions exist to check.
  read(p)
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

test("the denied shell renders identity and exit controls only — no db, no actions", () => {
  const src = readCode("src/components/AdminDenied.tsx");
  assert.match(src, /AdminAccountBar/, "denied shell must include the account strip");
  assert.doesNotMatch(src, /getScopedDb|from "@\/lib\/db|prisma/, "denied shell must not touch the database");
  assert.doesNotMatch(src, /Action\b|actions"/, "denied shell must not import server actions");
});

test("both admin layouts return the denied shell before any protected read", () => {
  for (const path of ["src/app/tenant-admin/layout.tsx", "src/app/platform-admin/layout.tsx"]) {
    const src = readCode(path);
    const denied = src.indexOf("<AdminDenied");
    assert.ok(denied > -1, `${path} must use the shared denied shell`);

    // Any tenant-scoped read must come strictly after the denied return,
    // so authorization failing means the read never happens. Matched on
    // the CALL, not the name, so the top-of-file import does not count.
    const scoped = src.indexOf("getScopedDb(");
    if (scoped > -1) {
      assert.ok(scoped > denied, `${path} reads the database before returning the denied shell`);
    }
  }
});

test("the account strip is shared, not re-implemented per layout", () => {
  // The regression guard: a layout rendering AdminAccount directly again
  // would reintroduce the branch-local copy that the denied path missed.
  for (const path of ["src/app/tenant-admin/layout.tsx", "src/app/platform-admin/layout.tsx"]) {
    const src = read(path);
    assert.match(src, /<AdminAccountBar\s*\/>/, `${path} must render the shared account bar`);
    assert.doesNotMatch(src, /<AdminAccount\s/, `${path} must not render AdminAccount directly`);
  }
});

test("sign-out goes through Clerk's own flow and lands on /sign-in", () => {
  const src = read("src/components/AdminAccount.tsx");
  assert.match(src, /from '@clerk\/nextjs'/, "must use Clerk's supported client API");
  assert.match(src, /<SignOutButton redirectUrl="\/sign-in">/);
  // No hand-rolled session teardown or token handling.
  assert.doesNotMatch(src, /sessionId|getToken|document\.cookie/);
});
