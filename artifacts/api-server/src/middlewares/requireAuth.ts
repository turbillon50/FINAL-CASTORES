import type { Request, Response, NextFunction } from "express";
import { getRequestUser } from "../lib/getRequestUser";

/**
 * Middleware that requires an authenticated user.
 * Uses the same resolution as getRequestUser: Clerk JWT (verified) and/or
 * Express session (e.g. after `/api/auth/clerk-me` or demo `/api/auth/login`).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }

    req.authUser = user;
    next();
  } catch {
    res.status(503).json({ ok: false, error: "database_unavailable", message: "Sin conexión a la base de datos" });
  }
}
