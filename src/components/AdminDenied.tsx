import Link from "next/link";
import { AdminAccountBar } from "./AdminAccountBar";

/**
 * The shell shown when an authenticated user is NOT authorized for the
 * admin surface they requested.
 *
 * Deliberately renders only identity and exit controls: the account strip
 * (email + Sign out) and a link to the public storefront. It receives no
 * tenant, no db handle and no server actions, so there is structurally
 * nothing protected for it to leak -- authorization has already failed by
 * the time this renders, and it stays failed.
 *
 * `surface` names the admin area that was refused, so the message is
 * specific about what access is missing rather than generic.
 */
export function AdminDenied({ surface }: { surface: string }) {
  return (
    <div className="admin-chrome flex flex-1 flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-6">
          <h1 className="text-xl font-semibold tracking-tight">{surface}</h1>
          <AdminAccountBar />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-6 py-10">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5 sm:p-6">
          {/* role="alert" is wrong here: this is the page's own purpose,
              already announced by the heading, not an event interrupting
              something the user was doing. */}
          <h2 className="text-2xl font-semibold tracking-tight">Not authorized</h2>
          <p className="text-sm text-muted-foreground">
            Your account does not have access to {surface}. If this is unexpected, sign out and sign
            back in with an account that does.
          </p>
          <Link
            href="/"
            className="w-fit rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-muted"
          >
            Go to storefront
          </Link>
        </div>
      </main>
    </div>
  );
}
