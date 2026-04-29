import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, invitationCodesTable, USER_ROLES } from "@workspace/db";
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
  } catch {
    res.json({ valid: false, reason: "Sin conexión a la base de datos" });
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
router.delete("/invitations/:id", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Acceso denegado" }); return; }

  const id = Number(req.params.id);
  await db.update(invitationCodesTable).set({ isActive: false })
    .where(eq(invitationCodesTable.id, id));

  res.json({ success: true });
});

export default router;
