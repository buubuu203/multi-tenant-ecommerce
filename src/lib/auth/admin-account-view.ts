// What the shared admin account bar is allowed to display, decided
// independently of Clerk and of React so it can be unit-tested (the same
// reasoning as resolveTenantAdminAuthorization() next door).
//
// This is deliberately NOT an authorization decision and must never be
// mistaken for one: it answers only "is someone signed in, and what is
// their own email address?" Being signed in says nothing about whether
// the request is allowed into Platform Admin or a given store's admin --
// those checks stay exactly where they were, in requirePlatformAdmin()
// and requireTenantAdmin().

/**
 * The narrow shape read off Clerk's user object. Only the primary email
 * is accepted; publicMetadata, tenant ids, session ids and tokens are
 * deliberately absent from this type, so the account bar structurally
 * cannot render any of them.
 */
export type AdminAccountUserLike =
  | { primaryEmailAddress?: { emailAddress?: string | null } | null }
  | null
  | undefined;

export type AdminAccountView =
  /** No session: render no account information at all. */
  | { signedIn: false }
  /**
   * A session exists. `email` is the user's own primary address, or null
   * for the rare authenticated user that has none — they still get the
   * sign-out control, since being unable to leave is worse than a missing
   * address.
   */
  | { signedIn: true; email: string | null };

export function resolveAdminAccountView(user: AdminAccountUserLike): AdminAccountView {
  if (!user) {
    return { signedIn: false };
  }
  const email = user.primaryEmailAddress?.emailAddress?.trim();
  return { signedIn: true, email: email ? email : null };
}
