import type { Request } from "express";
import { getRequestUser } from "./getRequestUser";

export type AuthedUser = { id: number; role: string };

/**
 * Resolved user for the current request.
 * Prefer `authUser` set by `requireAuth` (avoids a second DB hit); otherwise Clerk JWT / session.
 */
export async function resolveAuthedUser(req: Request): Promise<AuthedUser | null> {
  const fromMiddleware = (req as Request & { authUser?: AuthedUser }).authUser;
  if (fromMiddleware) return fromMiddleware;
  return getRequestUser(req);
}
