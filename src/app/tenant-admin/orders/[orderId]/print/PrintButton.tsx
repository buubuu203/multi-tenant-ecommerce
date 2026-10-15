'use client';

export function PrintButton({ documentTitle }: { documentTitle: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center justify-center rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground lg:min-h-9"
    >
      Print {documentTitle.toLowerCase()}
    </button>
  );
}
