import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getAuth, clerkClient } from "@clerk/express";
import { createHmac } from "node:crypto";
import { sendApprovalEmail, sendRejectionEmail, sendPasswordResetEmail } from "../lib/email";
import { getRequestUserStrict } from "./../lib/getRequestUser";
import { hasPermission } from "../lib/permissions";
import { logAdminOverride } from "../lib/adminOverride";
import { formatZodError } from "../lib/zodError";
import {
  CreateUserBody,
  UpdateUserBody,
  GetUserParams,
  UpdateUserParams,
  DeleteUserParams,
  ListUsersQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * STRICT auth resolver for /me routes.
 * Only accepts: (1) verified server session, or (2) verified Clerk JWT.
 * Does NOT trust query-string identity. Required for destructive endpoints
 * like account deletion to prevent IDOR.
 */
async function resolveMeUser(req: any): Promise<typeof usersTable.$inferSelect | null> {
  const sessionId = req.session?.userId;
  if (sessionId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, sessionId));
    return u ?? null;
  }
  const { userId: jwtClerkId } = getAuth(req);
  if (jwtClerkId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, jwtClerkId));
    return u ?? null;
  }
  return null;
}

// ── /me routes (must come before /:id) ────────────────────────────
router.get("/users/me", async (req, res): Promise<void> => {
  const user = await resolveMeUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  const { passwordHash: _ph, ...safe } = user;
  res.json(safe);
});

router.post("/users/me/accept-terms", async (req, res): Promise<void> => {
  const user = await resolveMeUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  const { version } = (req.body ?? {}) as { version?: string };
  const [updated] = await db
    .update(usersTable)
    .set({ termsAcceptedAt: new Date(), termsVersion: version ?? "1.0" })
    .where(eq(usersTable.id, user.id))
    .returning();
  const { passwordHash: _ph, ...safe } = updated;
  res.json(safe);
});

// Soft-delete account (anonymize PII, preserve audit). Required for store compliance.
// STRICT auth only — never trusts query-string identity.
router.delete("/users/me", async (req, res): Promise<void> => {
  const user = await resolveMeUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  // Fetch clerkId BEFORE anonymizing so we can delete from Clerk
  const [fullUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  const clerkId = fullUser?.clerkId ?? null;

  const anonEmail = `deleted_${user.id}_${Date.now()}@deleted.castores.local`;
  await db.update(usersTable).set({
    name: "Cuenta eliminada",
    email: anonEmail,
    phone: null,
    company: null,
    avatarUrl: null,
    clerkId: null,
    passwordHash: null,
    isActive: false,
    approvalStatus: "rejected",
    deletedAt: new Date(),
  }).where(eq(usersTable.id, user.id));

  // Also remove from Clerk so the user can re-register with the same email
  if (clerkId) {
    try {
      await clerkClient.users.deleteUser(clerkId);
    } catch (e) {
      // Non-fatal: DB record is already anonymized; log and continue
      console.warn(`[delete-account] Could not delete Clerk user ${clerkId}:`, e);
    }
  }

  res.json({ success: true, message: "Cuenta eliminada permanentemente" });
});

router.get("/users", async (req, res): Promise<void> => {
  const actor = await getRequestUserStrict(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }

  const parsed = ListUsersQueryParams.safeParse(req.query);
  const query = db.select().from(usersTable);
  const users = await query.orderBy(usersTable.createdAt);

  const canViewAll = await hasPermission(actor.role, "workersView");
  const scopedUsers = canViewAll
    ? users
    : users.filter((u) => u.id === actor.id);

  const result = scopedUsers.map(({ passwordHash: _, ...u }) => u);

  if (parsed.success && parsed.data.role) {
    res.json(result.filter((u) => u.role === parsed.data.role));
    return;
  }

  res.json(result);
});

router.post("/users", async (req, res): Promise<void> => {
  const actor = await getRequestUserStrict(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!await hasPermission(actor.role, "workersManage")) {
    res.status(403).json({ error: "No tienes permiso para crear usuarios" });
    return;
  }

  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const { password, ...rest } = parsed.data as typeof parsed.data & { password?: string };
  const [user] = await db
    .insert(usersTable)
    .values({ ...rest, passwordHash: password || null })
    .returning();

  const { passwordHash: _, ...safeUser } = user;
  res.status(201).json(safeUser);
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const actor = await getRequestUserStrict(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }

  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  if (actor.role !== "admin" && actor.role !== "supervisor" && params.data.id !== actor.id) {
    res.status(403).json({ error: "No tienes permiso para ver este usuario" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  const { passwordHash: _, ...safeUser } = user;
  res.json(safeUser);
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const actor = await getRequestUserStrict(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }

  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  // Solo admins pueden editar a otros usuarios. Cualquier usuario puede
  // editar su propio perfil (vía PATCH /users/:id donde id === actor.id).
  if (actor.role !== "admin" && params.data.id !== actor.id) {
    res.status(403).json({ error: "No tienes permiso para editar este usuario" });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  // Solo admins pueden cambiar role / approvalStatus / isActive de cualquier
  // usuario. Bloquear esos campos para no-admins evita escalada de privilegios.
  if (actor.role !== "admin") {
    delete (parsed.data as Record<string, unknown>).role;
    delete (parsed.data as Record<string, unknown>).approvalStatus;
    delete (parsed.data as Record<string, unknown>).isActive;
  }

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== null && v !== undefined) data[k] = v;
  }

  const [user] = await db
    .update(usersTable)
    .set(data)
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  const { passwordHash: _, ...safeUser } = user;
  res.json(safeUser);
});

router.patch("/users/:id/approve", async (req, res): Promise<void> => {
  const actor = await getRequestUserStrict(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (actor.role !== "admin") {
    res.status(403).json({ error: "Solo administradores pueden aprobar usuarios" });
    return;
  }

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  // Permite re-aprobar usuarios previamente rechazados — siempre los reactivamos.
  const [user] = await db.update(usersTable)
    .set({ approvalStatus: "approved", isActive: true, updatedAt: new Date() })
    .where(eq(usersTable.id, id))
    .returning();

  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  // Notify user of approval (fire and forget)
  sendApprovalEmail({ to: user.email, name: user.name, role: user.role }).catch(() => {});

  const { passwordHash: _, ...safe } = user;
  res.json(safe);
});

router.patch("/users/:id/reject", async (req, res): Promise<void> => {
  const actor = await getRequestUserStrict(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (actor.role !== "admin") {
    res.status(403).json({ error: "Solo administradores pueden rechazar usuarios" });
    return;
  }

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  // No permitir auto-rechazo (un admin se podría dejar fuera del sistema sin querer).
  if (id === actor.id) {
    res.status(400).json({ error: "No puedes rechazarte a ti mismo" });
    return;
  }

  const [user] = await db.update(usersTable)
    .set({ approvalStatus: "rejected", isActive: false, updatedAt: new Date() })
    .where(eq(usersTable.id, id))
    .returning();

  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  // Notify user of rejection (fire and forget)
  sendRejectionEmail({ to: user.email, name: user.name }).catch(() => {});

  const { passwordHash: _, ...safe } = user;
  res.json(safe);
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const actor = await getRequestUserStrict(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (actor.role !== "admin") {
    res.status(403).json({ error: "Solo administradores pueden eliminar usuarios" });
    return;
  }

  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  // No permitir auto-eliminación desde aquí; usar /users/me.
  if (params.data.id === actor.id) {
    res.status(400).json({ error: "No puedes eliminarte a ti mismo desde aquí. Usa la opción de borrar cuenta." });
    return;
  }

  // Fetch clerkId + name + email before mutating so podemos hacer
  // anonimización de fallback (más abajo) y borrar de Clerk.
  const [target] = await db.select({
    clerkId: usersTable.clerkId,
    name: usersTable.name,
    email: usersTable.email,
  }).from(usersTable).where(eq(usersTable.id, params.data.id));

  if (!target) {
    res.sendStatus(204);
    return;
  }

  // Borrado: intentamos hard-delete primero. Si hay FK constraint
  // (bitácoras, materiales, etc. apuntando al usuario) anonimizamos
  // para liberar el email y deshabilitar la cuenta sin perder histórico.
  // Antes este path fallaba silencioso y dejaba al usuario "borrado en
  // UI pero presente en DB", lo que rompía cualquier intento de re-registro.
  let didHardDelete = false;
  let didAnonymize = false;
  try {
    await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
    didHardDelete = true;
  } catch (err: any) {
    if (err?.code === "23503") {
      const ts = Date.now();
      const anonEmail = `deleted_${params.data.id}_${ts}@deleted.local`;
      await db.update(usersTable).set({
        email: anonEmail,
        clerkId: null,
        isActive: false,
        approvalStatus: "rejected",
        name: `[Eliminado] ${target.name ?? "Usuario"}`,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, params.data.id));
      didAnonymize = true;
    } else {
      throw err;
    }
  }

  if (target.clerkId) {
    try {
      await clerkClient.users.deleteUser(target.clerkId);
    } catch (e) {
      console.warn(`[admin-delete-user] Could not delete Clerk user ${target.clerkId}:`, e);
    }
  }

  res.json({ ok: true, hardDeleted: didHardDelete, anonymized: didAnonymize });
});

/**
 * POST /users/:id/send-password-reset — admin envía un correo de reset
 * a cualquier usuario. Pensado para destrabar a alguien sin tener que
 * compartirle una contraseña temporal por WhatsApp. Reusa el mismo
 * token HMAC firmado de /auth/forgot-password (TTL 30 min).
 */
router.post("/users/:id/send-password-reset", async (req, res): Promise<void> => {
  const actor = await getRequestUserStrict(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (actor.role !== "admin") {
    res.status(403).json({ error: "Solo administradores pueden enviar reset de contraseña" });
    return;
  }
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  if (!target.isActive) { res.status(400).json({ error: "El usuario está inactivo" }); return; }

  const RESET_TTL_MIN = 30;
  const exp = Date.now() + RESET_TTL_MIN * 60 * 1000;
  const secret =
    process.env["SESSION_SECRET"] ||
    process.env["CLERK_SECRET_KEY"] ||
    "castores-reset-fallback-only-for-dev";
  const payload = { userId: target.id, email: target.email.toLowerCase(), exp };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  const token = `${body}.${sig}`;
  const resetUrl = `https://castores.info/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendPasswordResetEmail({
      to: target.email,
      name: target.name || "Usuario",
      resetUrl,
      expiresInMinutes: RESET_TTL_MIN,
    });
  } catch (err) {
    res.status(503).json({ error: "No pudimos enviar el correo. Intenta de nuevo en un minuto." });
    return;
  }

  await logAdminOverride({
    actorId: actor.id,
    action: "user.password_reset_sent",
    description: `Admin ${actor.name} envió correo de reset a ${target.name} <${target.email}>`,
  });

  res.json({ ok: true, message: `Enlace de recuperación enviado a ${target.email}` });
});

export default router;
