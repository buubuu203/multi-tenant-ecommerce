"use client";

import { useState } from "react";
import { showToast } from "@/components/Toast";

/**
 * Downloads a tenant-scoped CSV export.
 *
 * Why a fetch + Blob rather than a plain <a download> or a Server Action:
 *
 *  - A plain link cannot report progress or failure. The download would
 *    either happen or silently not, and an authorization redirect would
 *    land the browser on a sign-in page instead of telling the merchant.
 *  - A Server Action cannot set Content-Disposition, so it cannot make the
 *    browser save a file; returning the CSV through the RSC payload and
 *    building the Blob here is the same work with an extra hop.
 *
 * So this calls the authorized GET route, which does its own
 * requireTenantAdmin(), and turns the response into a download. Credentials
 * ride along because it is a same-origin request. Nothing about the request
 * is attacker-controlled from this component: `dataset` is a literal passed
 * by the server-rendered page, never user input.
 */
export function ExportCsvButton({
  dataset,
  label,
}: {
  dataset: "products" | "orders";
  label: string;
}) {
  const [pending, setPending] = useState(false);

  async function handleExport() {
    // Second layer against a double-click; the button is also disabled.
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch(`/tenant-admin/exports/${dataset}`, {
        // Same-origin so the session cookie is sent; the route authorizes.
        credentials: "same-origin",
        headers: { Accept: "text/csv" },
      });

      if (!response.ok) {
        // Explicit, not a silent no-op: a merchant must know the export
        // did not happen. 404 here means the route declined, which for a
        // signed-in user means they are not this store's admin.
        showToast(
          response.status === 404
            ? "Export not available for this account."
            : `Export failed (${response.status}). Please try again.`,
          "error",
        );
        return;
      }

      const blob = await response.blob();
      // Prefer the server's filename; fall back to a locally composed safe
      // one rather than trusting anything arbitrary.
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `${dataset}.csv`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Release immediately — the download has already been handed to the
      // browser, and holding the object URL would keep the CSV in memory.
      URL.revokeObjectURL(url);

      showToast(`${label} exported.`, "success");
    } catch {
      showToast("Export failed. Please check your connection and try again.", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={pending}
      aria-busy={pending}
      className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
    >
      {pending ? "Preparing…" : `Export ${label} (CSV)`}
    </button>
  );
}
