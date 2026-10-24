"use client";

import { useEffect } from "react";
import Link from "next/link";

// Root-level error boundary for the buyer storefront. A customer must
// never see a framework crash screen, and must never see raw error text
// (a stack trace or query fragment is both meaningless and a leak) — the
// detail goes to the console only.
//
// Wording is deliberately customer-facing: it says what to do next and
// reassures about the one thing a shopper actually worries about when a
// store errors, which is whether they were charged.
export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        This page couldn&apos;t load. Nothing was ordered and you haven&apos;t been charged.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          Back to store
        </Link>
      </div>
    </main>
  );
}
