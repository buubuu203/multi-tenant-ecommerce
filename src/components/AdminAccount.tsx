'use client';

import { SignOutButton } from '@clerk/nextjs';

type AdminAccountProps = {
  /**
   * The signed-in user's own primary email, or null for an authenticated
   * user that has none — they still get the Sign out control, because
   * being unable to leave is worse than a missing address.
   */
  email: string | null;
};

export function AdminAccount({ email }: AdminAccountProps) {
  return (
    <section
      aria-label="Signed-in account"
      className="flex w-full flex-col gap-3 rounded-md border border-border bg-surface-muted p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Signed in as
        </p>
        {/* The address is always rendered as text, never only as a title
            attribute — it has to be readable without hovering, including
            at 375px, where `truncate` shortens it visually but leaves the
            full value to assistive technology via the title. */}
        <p className="truncate text-sm" title={email ?? undefined}>
          {email ?? 'Account with no email address'}
        </p>
      </div>
      {/* Clerk's own sign-out flow; redirectUrl sends the browser to
          /sign-in once the session is actually destroyed. */}
      <SignOutButton redirectUrl="/sign-in">
        <button
          type="button"
          className="w-full shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground sm:w-auto"
        >
          Sign out
        </button>
      </SignOutButton>
    </section>
  );
}
