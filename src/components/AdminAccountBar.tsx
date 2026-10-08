import { currentUser } from "@clerk/nextjs/server";
import { resolveAdminAccountView } from "@/lib/auth/admin-account-view";
import { AdminAccount } from "./AdminAccount";

/**
 * The one place the signed-in account strip is rendered, used by BOTH the
 * authorized admin layouts and the denied shell.
 *
 * It exists because the account controls previously lived inline inside
 * each layout's authorized branch, so the "Not authorized" early-return
 * rendered before them and a denied user had no way to see who they were
 * signed in as or to sign out. Sharing one component means the denied
 * path cannot drift out of sync with the authorized one again.
 *
 * Renders nothing at all when there is no session, so private account
 * information never appears for an unauthenticated visitor. Reads only
 * the user's own primary email -- never publicMetadata, tenant ids,
 * session ids or tokens.
 */
export async function AdminAccountBar() {
  const view = resolveAdminAccountView(await currentUser());
  if (!view.signedIn) {
    return null;
  }
  return <AdminAccount email={view.email} />;
}
