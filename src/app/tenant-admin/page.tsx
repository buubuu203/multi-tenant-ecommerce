import { redirect } from "next/navigation";

// Phase 1 of the admin route split: /tenant-admin itself is no longer a
// page — every section (Branding, Payments, Bank transfer, Shipping,
// Catalog, Orders) is its own route under this directory, each with its
// own scoped data fetch (see layout.tsx for the shared chrome). Branding
// is the natural landing section, same as it was the first tab before.
export default function TenantAdminIndexPage() {
  redirect("/tenant-admin/branding");
}
