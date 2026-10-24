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
    // Compact by design: this is chrome, not content. It previously
    // rendered as a full-width card directly under the page title, which
    // gave the operator's own email more visual weight than the store they
    // were managing. It now sits inline in the header and stacks only when
    // there is genuinely no room.
    <section
      aria-label="Signed-in account"
      className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 py-1.5"
    >
      <div className="flex min-w-0 flex-col leading-tight">
        <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Signed in as
        </p>
        {/* The address is always rendered as text, never only as a title
            attribute — it has to be readable without hovering, including
            at 375px, where `truncate` shortens it visually but leaves the
            full value to assistive technology via the title. */}
        <p className="max-w-[12rem] truncate text-xs sm:max-w-[16rem]" title={email ?? undefined}>
          {email ?? 'Account with no email address'}
        </p>
      </div>
      {/* Clerk's own sign-out flow; redirectUrl sends the browser to
          /sign-in once the session is actually destroyed. */}
      <SignOutButton redirectUrl="/sign-in">
        <button
          type="button"
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          Sign out
        </button>
      </SignOutButton>
    </section>
  );
}
