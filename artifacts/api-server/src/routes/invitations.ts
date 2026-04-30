import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, invitationCodesTable, usersTable, USER_ROLES } from "@workspace/db";
import { randomBytes } from "crypto";
import { getRequestUser } from "../lib/getRequestUser";

const router: IRouter = Router();

const ADMIN_MASTER_KEY = (
  process.env["ADMIN_ACCESS_PHRASE"] ||
  process.env["ADMIN_MASTER_KEY"] ||
  ""
)
  .trim()
  .toUpperCase();
const LEGACY_MASTER_KEY = "CASTORES";

function isMasterAdminKey(rawCode: string): boolean {
  const normalized = rawCode.trim().toUpperCase();
  return normalized === LEGACY_MASTER_KEY || (!!ADMIN_MASTER_KEY && normalized === ADMIN_MASTER_KEY);
}

// GET /invite/:code — public redirect link (never cached, bypasses SPA cache)
// Redirects the browser to /sign-up?code=CODE so the frontend can auto-fill it
router.get("/invite/:code", (req, res): void => {
  const { code } = req.params;
  const safe = encodeURIComponent(code.toUpperCase());
  const publicBase = (process.env["FRONTEND_PUBLIC_URL"] || "").replace(/\/+$/, "");
  const target = publicBase
    ? `${publicBase}/sign-up?code=${safe}`
    : `/sign-up?code=${safe}`;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.redirect(302, target);
});

// POST /invitations/validate — public, no auth required
router.post("/invitations/validate", async (req, res): Promise<void> => {
  const { code } = req.body as { code?: string };
  if (!code) { res.status(400).json({ valid: false }); return; }
  const normalizedCode = code.trim().toUpperCase();

  // Special master admin key
  if (isMasterAdminKey(normalizedCode)) {
    res.json({ valid: true, role: "admin", label: "Administrador Master" });
    return;
  }

  try {
    const [inv] = await db.select().from(invitationCodesTable).where(
      and(eq(invitationCodesTable.code, normalizedCode), eq(invitationCodesTable.isActive, true)),
    );

    if (!inv) {
      res.json({ valid: false });
      return;
    }

    if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
      res.json({ valid: false, reason: "Código expirado" });
      return;
    }

    if (inv.usedBy) {
      res.json({ valid: false, reason: "Código ya utilizado" });
      return;
    }

    res.json({ valid: true, role: inv.role, label: inv.label ?? null });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    req.log?.error?.({ err, code: e?.code, message: e?.message }, "invitations/validate db error");
    const reason =
      e?.code === "42P01"
        ? "Tablas no inicializadas (faltan migraciones)"
        : e?.message
          ? `DB: ${e.message}`
          : "Sin conexión a la base de datos";
    res.json({ valid: false, reason });
  }
});

// GET /invitations — admin only
router.get("/invitations", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Acceso denegado" }); return; }

  const invitations = await db.select().from(invitationCodesTable)
    .orderBy(invitationCodesTable.createdAt);
  res.json(invitations);
});

// POST /invitations — admin only
router.post("/invitations", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Acceso denegado" }); return; }

  const { role, label, expiresAt } = req.body as {
    role?: string; label?: string; expiresAt?: string;
  };

  if (!role || !(USER_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({ error: "Rol inválido" });
    return;
  }

  // Retry a few times to avoid rare collisions on unique invite code.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomBytes(4).toString("hex").toUpperCase();
    try {
      const [inv] = await db.insert(invitationCodesTable).values({
        code,
        role,
        label: label ?? null,
        createdBy: user.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: true,
      }).returning();
      res.status(201).json(inv);
      return;
    } catch {
      // Retry on conflict/transient insert errors
    }
  }
  res.status(500).json({ error: "No se pudo generar una invitación única, intenta de nuevo." });
});

// DELETE /invitations/:id — admin only
//
// REVOKES the invitation AND, if it was already used by someone, immediately
// deactivates that user's account so they lose access on the next request.
// This implements the admin's promise: "borrar la clave = quitar el acceso".
router.delete("/invitations/:id", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Acceso denegado" }); return; }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  // Read first so we know which user (if any) was registered with this code.
  const [inv] = await db.select().from(invitationCodesTable).where(eq(invitationCodesTable.id, id));
  if (!inv) { res.status(404).json({ error: "Invitación no encontrada" }); return; }

  // Mark the invitation as inactive (no longer usable, no longer valid).
  await db.update(invitationCodesTable).set({ isActive: false })
    .where(eq(invitationCodesTable.id, id));

  // If somebody already registered with this code, deactivate them too.
  // Safety: never deactivate an admin via invitation revocation — admins are
  // managed through their own panel and should not be killable by removing
  // an old code.
  let revokedUserId: number | null = null;
  if (inv.usedBy) {
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, inv.usedBy));
    if (target && target.role !== "admin") {
      await db.update(usersTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(usersTable.id, target.id));
      revokedUserId = target.id;
    }
  }

  res.json({ success: true, revokedUserId });
});

export default router;
