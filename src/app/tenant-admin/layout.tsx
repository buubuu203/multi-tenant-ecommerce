import type { ReactNode } from "react";
import { requireTenantAdmin, NotTenantAdminError } from "@/lib/auth/require-tenant-admin";

export default async function TenantAdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireTenantAdmin();
  } catch (e) {
    if (e instanceof NotTenantAdminError) {
      return (
        <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-24 text-center">
          <h1 className="text-2xl font-semibold">Not authorized</h1>
          <p className="max-w-md text-black/70 dark:text-white/70">
            Your account does not have access to this store&apos;s admin.
          </p>
        </main>
      );
    }
    throw e; // e.g. Next.js's internal redirect signal from redirectToSignIn()
  }

  return <>{children}</>;
}
