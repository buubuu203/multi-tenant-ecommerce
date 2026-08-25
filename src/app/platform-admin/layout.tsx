import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";

// AUTHENTICATION — "who is this request from?"
// Entirely Clerk's responsibility. A missing userId means no signed-in
// session at all; there is nothing to authorize yet, so we redirect
// straight to sign-in. This check says nothing about what the user is
// allowed to do — only whether we know who they are.
async function requireAuthenticatedUser() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  return userId;
}

// AUTHORIZATION — "is this authenticated user allowed into Platform Admin?"
// Deliberately a separate function/step from authentication above. A valid
// Clerk session is never, by itself, proof of Platform Admin access.
//
// V1 source of truth: the signed-in Clerk user's own `publicMetadata.role`.
// Fetched via currentUser() (a live call to Clerk's backend), not read from
// a cached JWT session claim, so a role change in the Clerk dashboard takes
// effect on the next request rather than waiting for a new session/token.
async function isPlatformAdmin(): Promise<boolean> {
  const user = await currentUser();
  return user?.publicMetadata?.role === "platform_admin";
}

export default async function PlatformAdminLayout({ children }: { children: ReactNode }) {
  await requireAuthenticatedUser();

  if (!(await isPlatformAdmin())) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">Not authorized</h1>
        <p className="max-w-md text-black/70 dark:text-white/70">
          Your account does not have access to Platform Admin.
        </p>
      </main>
    );
  }

  return <>{children}</>;
}
