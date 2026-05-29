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

// ─── GET /users/access-audit — cruza Clerk ↔ BD ───────────────────────────────
// Audita el acceso real: Clerk solo da identidad; el acceso lo decide la BD
// (approvalStatus + isActive + rol). Combina ambas fuentes y marca, por persona,
// si tiene acceso o por qué no. Solo admin. Definido ANTES de /users/:id para
// que "access-audit" no se interprete como un id.
router.get("/users/access-audit", async (req, res): Promise<void> => {
  const actor = await getRequestUserStrict(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(actor.role, "adminPanelAccess"))) {
    res.status(403).json({ error: "Solo administradores pueden auditar el acceso" });
    return;
  }

  const dbUsers = await db.select().from(usersTable);
  const byClerkId = new Map<string, typeof dbUsers[number]>();
  const byEmail = new Map<string, typeof dbUsers[number]>();
  for (const u of dbUsers) {
    if (u.clerkId) byClerkId.set(u.clerkId, u);
    if (u.email) byEmail.set(u.email.toLowerCase(), u);
  }

  // Trae usuarios de Clerk (identidades). getUserList puede devolver array o
  // { data } según versión del SDK; soportamos ambas.
  let clerkUsers: any[] = [];
  let clerkError: string | null = null;
  try {
    const resp: any = await clerkClient.users.getUserList({ limit: 200 });
    clerkUsers = Array.isArray(resp) ? resp : (resp?.data ?? []);
  } catch (e: any) {
    clerkError = e?.message ?? "No se pudo consultar Clerk";
  }

  const clerkEmailOf = (cu: any): string | null => {
    const primary = cu.emailAddresses?.find((e: any) => e.id === cu.primaryEmailAddressId);
    return (primary?.emailAddress ?? cu.emailAddresses?.[0]?.emailAddress ?? null)?.toLowerCase() ?? null;
  };

  const matchedDbIds = new Set<number>();
  const rows: any[] = [];

  // 1) Recorre Clerk: cada identidad y su estado en la BD
  for (const cu of clerkUsers) {
    const email = clerkEmailOf(cu);
    const dbU = byClerkId.get(cu.id) ?? (email ? byEmail.get(email) : undefined);
    if (dbU) matchedDbIds.add(dbU.id);

    const name = dbU?.name
      || [cu.firstName, cu.lastName].filter(Boolean).join(" ").trim()
      || email || cu.id;

    let access: string;
    if (!dbU) access = "clerk_no_account";
    else if (dbU.approvalStatus === "rejected") access = "rejected";
    else if (dbU.approvalStatus === "pending") access = "pending";
    else if (!dbU.isActive) access = "inactive";
    else access = "ok";

    rows.push({
      name,
      email: email ?? dbU?.email ?? null,
      role: dbU?.role ?? null,
      approvalStatus: dbU?.approvalStatus ?? null,
      isActive: dbU?.isActive ?? null,
      inClerk: true,
      inDb: !!dbU,
      dbId: dbU?.id ?? null,
      clerkId: cu.id,
      lastSignInAt: cu.lastSignInAt ?? null,
      access,
    });
  }

  // 2) Usuarios en BD sin identidad Clerk. Los trabajadores (geocheck) usan
  // código+PIN y NO tienen Clerk: eso es normal, se marca aparte.
  for (const u of dbUsers) {
    if (matchedDbIds.has(u.id)) continue;
    const isWorkerNoEmail = u.role === "worker" && !u.email;
    rows.push({
      name: u.name,
      email: u.email ?? null,
      role: u.role,
      approvalStatus: u.approvalStatus,
      isActive: u.isActive,
      inClerk: false,
      inDb: true,
      dbId: u.id,
      clerkId: u.clerkId ?? null,
      lastSignInAt: null,
      access: isWorkerNoEmail ? "worker_code" : "db_no_clerk",
    });
  }

  // Orden: primero lo que requiere atención, luego ok.
  const order: Record<string, number> = {
    clerk_no_account: 0, pending: 1, inactive: 2, rejected: 3, db_no_clerk: 4, worker_code: 5, ok: 6,
  };
  rows.sort((a, b) => (order[a.access] ?? 9) - (order[b.access] ?? 9));

  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.access === "ok").length,
    needsAttention: rows.filter((r) => ["clerk_no_account", "pending", "inactive", "rejected"].includes(r.access)).length,
    clerkError,
  };

  res.json({ summary, rows });
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

  // Notify user of approval (fire and forget). Workers operativos no tienen
  // email y este endpoint no aplica para ellos — el guard evita un crash.
  if (user.email) {
    sendApprovalEmail({ to: user.email, name: user.name, role: user.role }).catch(() => {});
  }

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

  // Notify user of rejection (fire and forget). Skip cuando no hay email.
  if (user.email) {
    sendRejectionEmail({ to: user.email, name: user.name }).catch(() => {});
  }

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
  // Workers operativos no tienen email — el reset por correo no aplica
  // y debe explicarse al admin para que use la opción de "Reset PIN" en su lugar.
  if (!target.email) {
    res.status(400).json({ error: "Este usuario no tiene correo. Si es un trabajador operativo, usa Reset PIN." });
    return;
  }

  const RESET_TTL_MIN = 30;
  const exp = Date.now() + RESET_TTL_MIN * 60 * 1000;
  const secret =
    process.env["SESSION_SECRET"] ||
    process.env["CLERK_SECRET_KEY"] ||
    "castores-reset-fallback-only-for-dev";
  const targetEmail: string = target.email;
  const payload = { userId: target.id, email: targetEmail.toLowerCase(), exp };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  const token = `${body}.${sig}`;
  const resetUrl = `https://castores.info/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendPasswordResetEmail({
      to: targetEmail,
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
    description: `Admin (usuario #${actor.id}) envió correo de reset a ${target.name} <${targetEmail}>`,
  });

  res.json({ ok: true, message: `Enlace de recuperación enviado a ${targetEmail}` });
});

export default router;
