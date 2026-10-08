'use client';

import { SignOutButton } from '@clerk/nextjs';

type AdminAccountProps = {
  email: string;
};

export function AdminAccount({ email }: AdminAccountProps) {
  return (
    <section
      aria-label="Signed-in account"
      className="flex w-full flex-col gap-3 rounded-md border border-border bg-surface-muted p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Signed in as
        </p>
        <p className="truncate text-sm" title={email}>
          {email}
        </p>
      </div>
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
