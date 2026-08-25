import { platformDb } from "@/lib/db/platform-db";

// Deliberately minimal — this checkpoint only proves the authentication +
// authorization boundary and the platformDb wiring. Tenant list/create/edit
// UI is Checkpoint 3C, not this one.
export const dynamic = "force-dynamic";

export default async function PlatformAdminHomePage() {
  const tenantCount = await platformDb.tenant.count();

  return (
    <main className="flex flex-1 flex-col gap-2 px-6 py-16">
      <h1 className="text-2xl font-semibold">Platform Admin</h1>
      <p className="text-black/70 dark:text-white/70">{tenantCount} tenant(s) in the platform.</p>
    </main>
  );
}
