import Link from "next/link";
import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { CreateProductForm } from "../../CreateProductForm";
import { AdminPageHeader } from "../../AdminPageHeader";
import { adminSectionClassName } from "../../styles";

export const dynamic = "force-dynamic";

// Add Product, on its own page rather than as one cramped card among many
// on the dashboard — a form this central to daily merchant use deserves
// the room.
//
// This page deliberately renders NO shell of its own. It previously
// wrapped itself in its own <TenantTheme> and its own <main>, which under
// the dashboard shell meant a <main> nested inside the layout's <main>
// (two main landmarks on one page) and a second theme provider inside the
// first. Removing both also removes the two branding queries this page ran
// purely to feed that duplicate theme — the layout already resolves them
// once for every route beneath it.
//
// requireTenantAdmin() stays: every admin page authorizes itself before
// any read, because a layout's gate does not stop a child page segment
// from rendering and streaming its own payload.
export default async function NewProductPage() {
  await requireTenantAdmin();

  return (
    <section className={adminSectionClassName}>
      <AdminPageHeader
        title="Add a product"
        description="Create a product with a single price. Variants, media, stock and discounts are set up afterwards in the catalog editor."
        actions={
          <Link
            href="/tenant-admin/catalog"
            className="text-sm text-muted-foreground underline transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Back to catalog
          </Link>
        }
      />

      <div className="max-w-2xl">
        <CreateProductForm />
      </div>
    </section>
  );
}
