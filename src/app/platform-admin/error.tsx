"use client";

import { useEffect } from "react";

// Route-segment error boundary for Platform Admin, mirroring the one
// already covering /tenant-admin/*. Never renders `error.message` to the
// page — an operator-facing screen is not the place for a stack trace or
// query fragment; it goes to the console only.
export default function PlatformAdminError({
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
    <main role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Platform Admin couldn&apos;t load. No tenant data was changed — try again.
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
