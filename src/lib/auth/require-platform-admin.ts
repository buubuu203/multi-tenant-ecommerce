import { auth, currentUser } from "@clerk/nextjs/server";

export class NotAuthenticatedError extends Error {}
export class NotAuthorizedError extends Error {}

/**
 * The shared authentication + authorization check every Platform Admin
 * mutation must call independently. The platform-admin/layout.tsx page
 * gate (Checkpoint 3B) is necessary but not sufficient on its own — this
 * is the same two-step check (authentication via auth(), then
 * authorization via publicMetadata.role), applied again at the mutation
 * boundary so a Server Action can never be reached in an unverified state.
 */
export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  const { userId } = await auth();
  if (!userId) {
    throw new NotAuthenticatedError("Not signed in");
  }

  const user = await currentUser();
  if (user?.publicMetadata?.role !== "platform_admin") {
    throw new NotAuthorizedError("Not authorized for Platform Admin");
  }

  return { userId };
}
