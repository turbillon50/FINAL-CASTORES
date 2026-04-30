import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getAuth } from "@clerk/express";

/**
 * Resolves the current user from the request.
 *
 * SECURITY: Only trusts Clerk-verified JWT (set on req by clerkMiddleware) or
 * the legacy server-side session cookie. Query params like ?clerkId / ?email
 * are NEVER honored — they were a temporary backfill that allowed account
 * impersonation. The frontend may still send them for backwards compatibility,
 * but the server ignores them.
 *
 * Backfill: when a JWT-authenticated request comes in and the matching user's
 * email exists in the DB but their clerk_id is empty, we link them.
 *
 * REVOCATION: users with isActive=false are treated as if they don't exist.
 * This makes invitation revocation take effect immediately on the next API
 * call without needing to invalidate Clerk sessions.
 */
export async function getRequestUser(
  req: any,
): Promise<{ id: number; role: string } | null> {
  const { userId: jwtClerkId } = getAuth(req);

  // 1. Clerk JWT — verified by middleware
  if (jwtClerkId) {
    const [u] = await db
      .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.clerkId, jwtClerkId));
    if (u) {
      if (!u.isActive) return null;
      return { id: u.id, role: u.role };
    }

    // Backfill: same JWT, but our user record was created via legacy flow
    // and has no clerk_id yet. We resolve by the *verified* JWT email claim
    // (NOT a query param). Only do this if Clerk gives us an email.
    const sessionClaims = (req as { auth?: { sessionClaims?: { email?: string } } }).auth?.sessionClaims;
    const verifiedEmail = sessionClaims?.email;
    if (verifiedEmail) {
      const [byEmail] = await db
        .select({ id: usersTable.id, role: usersTable.role, clerkId: usersTable.clerkId, isActive: usersTable.isActive })
        .from(usersTable)
        .where(eq(usersTable.email, verifiedEmail));
      if (byEmail && !byEmail.clerkId) {
        if (!byEmail.isActive) return null;
        await db
          .update(usersTable)
          .set({ clerkId: jwtClerkId })
          .where(eq(usersTable.id, byEmail.id));
        return { id: byEmail.id, role: byEmail.role };
      }
    }
  }

  // 2. Legacy session cookie (after express-session + /auth/login or /auth/clerk-me)
  const sessionId = req.session?.userId;
  if (sessionId) {
    const [u] = await db
      .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.id, sessionId));
    if (!u) return null;
    if (!u.isActive) return null;
    return { id: u.id, role: u.role };
  }

  return null;
}

/**
 * Strict version: only trusts session cookie or verified Clerk JWT.
 * Does NOT honor ?clerkId / ?email query fallbacks. Use for admin-only
 * destructive endpoints where impersonation must be impossible.
 * Also enforces isActive=true.
 */
export async function getRequestUserStrict(
  req: any,
): Promise<{ id: number; role: string } | null> {
  const sessionId = req.session?.userId;
  if (sessionId) {
    const [u] = await db
      .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.id, sessionId));
    if (!u || !u.isActive) return null;
    return { id: u.id, role: u.role };
  }

  const { userId: jwtClerkId } = getAuth(req);
  if (jwtClerkId) {
    const [u] = await db
      .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.clerkId, jwtClerkId));
    if (!u || !u.isActive) return null;
    return { id: u.id, role: u.role };
  }

  return null;
}
