"use client";

import { useEffect } from "react";

// Next.js's App Router error boundary for /tenant-admin/* — replaces the
// framework's default crash screen with something an admin can actually
// act on. Deliberately does NOT render `error.message` to the page (that
// could leak internal details — a stack trace, a query fragment); it's
// only sent to console.error, the same place any other uncaught
// server-side error in this app already surfaces for debugging.
export default function TenantAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        This section couldn&apos;t load. Your data is safe — try again, or come back in a moment.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        Try again
      </button>
    </main>
  );
}
