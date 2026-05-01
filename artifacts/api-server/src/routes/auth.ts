import { Router, type IRouter } from "express";
import { eq, or } from "drizzle-orm";
import { db, usersTable, invitationCodesTable, USER_ROLES, activityLogTable } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import { sendNewRegistrationEmail, sendWelcomeEmail } from "../lib/email";
import { and } from "drizzle-orm";

const ADMIN_MASTER_KEY = (process.env["ADMIN_ACCESS_PHRASE"] || process.env["ADMIN_MASTER_KEY"] || "").trim().toUpperCase();
const LEGACY_MASTER_KEY = "CASTORES";
const CLERK_SECRET_KEY = process.env["CLERK_SECRET_KEY"] ?? "";

function isMasterAdminKey(rawCode: string): boolean {
  const normalized = rawCode.trim().toUpperCase();
  return normalized === LEGACY_MASTER_KEY || (!!ADMIN_MASTER_KEY && normalized === ADMIN_MASTER_KEY);
}

function getVerifiedEmail(req: any): string | null {
  const claims = (req as { auth?: { sessionClaims?: { email?: string } } }).auth?.sessionClaims;
  return claims?.email ?? null;
}

/**
 * Calls Clerk Backend API. Throws on non-2xx with a normalized error.
 * Used by the invite-register endpoint to create a fully verified Clerk
 * user without going through the email OTP flow (which has been blocked
 * by various email providers' anti-spam filters).
 */
async function clerkApi(path: string, init: RequestInit = {}): Promise<any> {
  if (!CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY missing on server");
  }
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.errors?.[0]?.long_message || body.errors?.[0]?.message || body.message)) || `Clerk ${path} ${res.status}`;
    const err = new Error(msg) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const router: IRouter = Router();

router.post("/auth/admin-access", async (req, res): Promise<void> => {
  let clerkUserId: string | null = null;
  try {
    clerkUserId = getAuth(req).userId ?? null;
  } catch (authErr: unknown) {
    const detail = authErr instanceof Error ? authErr.message : String(authErr);
    logger.error({ detail }, "getAuth error in admin-access");
    res.status(503).json({ error: "auth_unavailable", detail });
    return;
  }
  if (!clerkUserId) {
    res.status(401).json({ error: "Sesión no verificada. Inicia sesión primero." });
    return;
  }

  const { phrase, name, email: bodyEmail } = req.body as { phrase?: string; name?: string; email?: string };
  if (!phrase || !isMasterAdminKey(phrase)) {
    res.status(403).json({ error: "Frase de acceso inválida" });
    return;
  }

  // Prefer email from verified JWT claims; fall back to email sent in body
  // (safe because clerkUserId was already verified via JWT above).
  const verifiedEmail = getVerifiedEmail(req) || bodyEmail?.trim() || null;
  if (!verifiedEmail) {
    res.status(400).json({ error: "No se pudo verificar el correo de la sesión Clerk" });
    return;
  }

  try {
    const existingByClerk = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkUserId));
    const existingByEmail = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, verifiedEmail));
    const existing = existingByClerk[0] ?? existingByEmail[0] ?? null;

    // The master phrase IS the owner key. Anyone who proves they have it
    // (via verified Clerk session + phrase match) becomes admin. The previous
    // single-admin check made it impossible for the owner to add a second
    // admin without going through invitations, which contradicts the intent.
    let user = existing;
    if (user) {
      const [updated] = await db
        .update(usersTable)
        .set({
          clerkId: clerkUserId,
          role: "admin",
          approvalStatus: "approved",
          isActive: true,
          termsAcceptedAt: user.termsAcceptedAt ?? new Date(),
          termsVersion: user.termsVersion ?? "1.0",
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, user.id))
        .returning();
      user = updated ?? user;
    } else {
      const [created] = await db
        .insert(usersTable)
        .values({
          clerkId: clerkUserId,
          name: name?.trim() || "Administrador General",
          email: verifiedEmail,
          role: "admin",
          isActive: true,
          approvalStatus: "approved",
          termsAcceptedAt: new Date(),
          termsVersion: "1.0",
        })
        .returning();
      user = created;
    }

    req.session.userId = user.id;

    await db.insert(activityLogTable).values({
      type: "admin_access_activated",
      description: "Activación/validación de administrador general con frase segura",
      userId: user.id,
    }).catch(() => {});

    const { passwordHash: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "db_error";
    logger.error({ err, msg }, "admin-access db error");
    res.status(503).json({ error: "Sin conexión a la base de datos", detail: msg });
  }
});

// Legacy demo login endpoint REMOVED.
// Previous behaviour: accepted plain-text "castores2024" as the admin password
// and trusted any non-admin email without a password at all. That short-circuit
// was OK during the in-app demo phase but became a credential-theft vector
// once production users existed: anyone who learned the demo string could
// promote themselves to admin via a single POST. The real sign-in path is now
// /api/auth/invite-login which delegates password verification to Clerk
// Backend API and returns a one-shot Clerk sign_in_token.
router.post("/auth/login", (_req, res): void => {
  res.status(410).json({ error: "Este endpoint ya no se usa. Inicia sesión desde /sign-in." });
});

/**
 * Backend-driven sign-in that bypasses Clerk's hosted sign-in UI entirely.
 *
 * Clerk's `<SignIn />` component asks the user for an email OTP every time
 * it sees a "new device" — even when the user already has a password. That
 * defeats the whole reason we made the user pick a password during sign-up.
 * The user gets stuck on the OTP screen on every fresh phone, browser, or
 * incognito window.
 *
 * This endpoint takes email + password directly, asks Clerk's Backend API to
 * verify the password (server-to-server, fully trusted), and if valid mints a
 * single-use Clerk sign_in_token. The frontend redirects to that token URL
 * and the user lands signed in. No OTP, no device verification.
 *
 * Public endpoint. Security comes from the password verification + the fact
 * that an attacker would need both the email and the password to reach the
 * sign_in_tokens step.
 *
 * Body: { email, password }
 * Response 200: { user, signInUrl }
 */
router.post("/auth/invite-login", async (req, res): Promise<void> => {
  const { email: rawEmail, password } = req.body as { email?: string; password?: string };
  if (!rawEmail || !password) {
    res.status(400).json({ error: "Correo y contraseña requeridos" });
    return;
  }
  const email = rawEmail.trim().toLowerCase();

  // 1) Find the Clerk user by email.
  let clerkUserId: string | null = null;
  try {
    const list = await clerkApi(`/users?email_address[]=${encodeURIComponent(email)}&limit=1`);
    const arr = Array.isArray(list) ? list : (list?.data ?? []);
    if (Array.isArray(arr) && arr.length > 0) clerkUserId = arr[0].id;
  } catch (err: unknown) {
    logger.error({ err }, "invite-login: lookup by email failed");
  }
  if (!clerkUserId) {
    res.status(401).json({ error: "Correo o contraseña incorrectos" });
    return;
  }

  // 2) Verify the password against Clerk.
  try {
    const verify = await clerkApi(`/users/${clerkUserId}/verify_password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    if (!verify || verify.verified !== true) {
      res.status(401).json({ error: "Correo o contraseña incorrectos" });
      return;
    }
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400 || e.status === 422) {
      // Clerk returns 400 / 422 when the password is wrong or the user has
      // no password set. Either way the safe answer for the user is the
      // same — generic "wrong creds" — so we don't leak which case it is.
      res.status(401).json({ error: "Correo o contraseña incorrectos" });
      return;
    }
    logger.error({ err: e, status: e.status }, "invite-login: verify_password call failed");
    res.status(503).json({ error: "No pudimos validar tu contraseña ahora. Intenta de nuevo." });
    return;
  }

  // 3) Make sure the user exists and is active in our DB.
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!user) {
    res.status(403).json({ error: "Tu cuenta no está dada de alta en Castores. Contacta a un administrador." });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "Tu cuenta está deshabilitada. Contacta a un administrador." });
    return;
  }

  // 4) Mint a one-shot sign-in token Clerk will accept as proof of identity.
  let signInUrl: string | null = null;
  try {
    const tokenRes = await clerkApi("/sign_in_tokens", {
      method: "POST",
      body: JSON.stringify({ user_id: clerkUserId, expires_in_seconds: 600 }),
    });
    signInUrl = tokenRes?.url ?? null;
  } catch (err: unknown) {
    logger.error({ err }, "invite-login: sign_in_token mint failed");
  }
  if (!signInUrl) {
    res.status(503).json({ error: "No pudimos iniciar sesión ahora. Intenta de nuevo." });
    return;
  }

  const { passwordHash: _, ...safeUser } = user;
  res.json({ user: safeUser, signInUrl });
});

/**
 * Backend-driven registration that bypasses Clerk's email OTP entirely.
 *
 * Why this exists: the email OTP path has repeatedly failed to deliver
 * verification codes (Hotmail filtering, custom domain mail rejecting Clerk's
 * sender, even Gmail intermittently dropping). Each failure stranded the
 * invitee on the "Revisa tu correo" screen with no way forward.
 *
 * This endpoint takes the registration form data + an invitation code and
 * does everything server-to-server with Clerk's Backend API:
 *   1. Validates the invitation against our DB (or recognises the master phrase).
 *   2. Creates the Clerk user with email pre-verified (skip_password_checks=false
 *      so the password meets Clerk's policy).
 *   3. Creates the Castores DB row with the invitation's role + approved status.
 *   4. Marks the invitation as used and writes an activity log entry.
 *   5. Mints a single-use Clerk sign_in_token so the frontend can hard-redirect
 *      the user straight into the dashboard with an active session, no email
 *      verification step required.
 *
 * Public endpoint (no Clerk JWT required) — security relies entirely on the
 * invitation code (or master phrase) being valid.
 *
 * Body: { name, email, password, role, invitationCode, acceptTerms, termsVersion?, company?, phone? }
 * Response 201: { user, signInUrl }
 */
router.post("/auth/invite-register", async (req, res): Promise<void> => {
  const {
    name, email: rawEmail, password, role, invitationCode,
    acceptTerms, termsVersion, company, phone,
  } = req.body as {
    name?: string; email?: string; password?: string; role?: string;
    invitationCode?: string; acceptTerms?: boolean; termsVersion?: string;
    company?: string; phone?: string;
  };

  if (!acceptTerms) {
    res.status(400).json({ error: "Debes aceptar los Términos y la Política de Privacidad" });
    return;
  }
  if (!name || !name.trim()) { res.status(400).json({ error: "Nombre requerido" }); return; }
  if (!rawEmail || !rawEmail.trim()) { res.status(400).json({ error: "Correo requerido" }); return; }
  if (!password || password.length < 8) { res.status(400).json({ error: "Contraseña debe tener al menos 8 caracteres" }); return; }
  if (!role || !(USER_ROLES as readonly string[]).includes(role)) { res.status(400).json({ error: "Rol inválido" }); return; }
  if (!invitationCode || !invitationCode.trim()) { res.status(400).json({ error: "Clave de invitación requerida" }); return; }

  const email = rawEmail.trim().toLowerCase();
  const upperCode = invitationCode.trim().toUpperCase();

  // Validate invitation
  let invitationRecord: typeof invitationCodesTable.$inferSelect | null = null;
  if (isMasterAdminKey(upperCode)) {
    if (role !== "admin") {
      res.status(400).json({ error: "La clave maestra es solo para administradores" });
      return;
    }
  } else {
    try {
      const [inv] = await db.select().from(invitationCodesTable)
        .where(and(eq(invitationCodesTable.code, upperCode), eq(invitationCodesTable.isActive, true)));
      if (!inv || inv.usedBy) {
        res.status(400).json({ error: "Código de invitación inválido o ya utilizado" });
        return;
      }
      if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
        res.status(400).json({ error: "El código de invitación ha expirado" });
        return;
      }
      if (inv.role !== role) {
        res.status(400).json({ error: `Este código es para el rol: ${inv.role}` });
        return;
      }
      invitationRecord = inv;
    } catch (err: unknown) {
      logger.error({ err }, "invite-register: invitation lookup failed");
      res.status(503).json({ error: "Sin conexión a la base de datos" });
      return;
    }
  }

  // Pre-check: refuse if a row with the same email already exists in our DB
  // (we won't try to merge on top of someone else's account).
  const [existingByEmail] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existingByEmail) {
    res.status(409).json({ error: "Este correo ya está registrado. Si eres tú, usa Iniciar sesión." });
    return;
  }

  // Generate a Clerk-friendly username from the email's local part. Clerk's
  // instance has username required and rejects values with @ / dots / dashes.
  const usernameBase = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 50) || "user";
  const usernameSuffix = Math.random().toString(36).slice(2, 6);
  const generatedUsername = `${usernameBase}_${usernameSuffix}`.slice(0, 64);

  const trimmedName = name.trim();
  const [firstName, ...rest] = trimmedName.split(/\s+/);
  const lastName = rest.join(" ") || trimmedName;

  // Create Clerk user (server-to-server, email auto-verified)
  let clerkUserId: string;
  try {
    const created = await clerkApi("/users", {
      method: "POST",
      body: JSON.stringify({
        email_address: [email],
        password,
        username: generatedUsername,
        first_name: firstName,
        last_name: lastName,
        skip_password_checks: false,
        skip_password_requirement: false,
      }),
    });
    clerkUserId = created.id;
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string; body?: any };
    logger.error({ err: e, status: e.status, body: e.body }, "invite-register: Clerk user create failed");
    if (e.status === 422 || e.status === 400) {
      const longMsg = (e.body as any)?.errors?.[0]?.long_message;
      res.status(400).json({ error: longMsg || e.message || "Clerk rechazó el registro. Verifica tu correo y contraseña." });
      return;
    }
    res.status(503).json({ error: "No se pudo crear la cuenta. Intenta de nuevo en unos minutos." });
    return;
  }

  // Persist in our DB
  let user;
  try {
    const [row] = await db.insert(usersTable).values({
      clerkId: clerkUserId,
      name: trimmedName,
      email,
      role,
      isActive: true,
      approvalStatus: "approved",
      termsAcceptedAt: new Date(),
      termsVersion: termsVersion ?? "1.0",
      company: company?.trim() || undefined,
      phone: phone?.trim() || undefined,
    }).returning();
    user = row;
  } catch (err: unknown) {
    logger.error({ err }, "invite-register: DB insert failed; rolling back Clerk user");
    // Best-effort rollback: delete the Clerk user we just created.
    await clerkApi(`/users/${clerkUserId}`, { method: "DELETE" }).catch(() => {});
    res.status(503).json({ error: "Sin conexión a la base de datos. La cuenta no quedó creada." });
    return;
  }

  // Mark invitation used
  if (invitationRecord) {
    await db.update(invitationCodesTable).set({
      usedBy: user.id,
      usedAt: new Date(),
      isActive: false,
    }).where(eq(invitationCodesTable.id, invitationRecord.id)).catch((err) => {
      logger.error({ err }, "invite-register: failed to mark invitation used");
    });
  }

  await db.insert(activityLogTable).values({
    type: "invite_register",
    description: `Registro vía invitación (${invitationRecord ? `código ${invitationRecord.code}` : "frase maestra"})`,
    userId: user.id,
  }).catch(() => {});

  // Mint a one-shot sign_in_token so the frontend can drop the user straight
  // into an authenticated session — no password retype, no OTP.
  let signInUrl: string | null = null;
  try {
    const tokenRes = await clerkApi("/sign_in_tokens", {
      method: "POST",
      body: JSON.stringify({ user_id: clerkUserId, expires_in_seconds: 600 }),
    });
    signInUrl = tokenRes?.url ?? null;
  } catch (err: unknown) {
    logger.error({ err }, "invite-register: sign_in_token mint failed (non-fatal)");
  }

  // Optional welcome email — never block on it.
  Promise.resolve().then(() => sendWelcomeEmail(email, trimmedName, role)).catch(() => {});

  const { passwordHash: _, ...safeUser } = user;
  res.status(201).json({
    user: safeUser,
    signInUrl,
    role,
  });
});

/**
 * Called right after Clerk signup to create the user in our DB as "pending".
 * Body: { name, email, role, company?, phone?, clerkId? }
 * The clerkId from the body is used as fallback if JWT validation is unavailable (dev mode).
 */
router.post("/auth/clerk-register", async (req, res): Promise<void> => {
  let clerkUserId: string | null = null;
  try {
    clerkUserId = getAuth(req).userId ?? null;
  } catch (authErr: unknown) {
    const detail = authErr instanceof Error ? authErr.message : String(authErr);
    logger.error({ detail }, "getAuth error in clerk-register");
    res.status(503).json({ error: "auth_unavailable", detail });
    return;
  }

  const { name, email, role, company, phone, clerkId: bodyClerkId, invitationCode, acceptTerms, termsVersion } = req.body as {
    name?: string; email?: string; role?: string; company?: string;
    phone?: string; clerkId?: string; invitationCode?: string;
    acceptTerms?: boolean; termsVersion?: string;
  };

  // SECURITY: Require a verified Clerk JWT. Without it, anyone with an
  // invitation code could create an admin account without owning the email.
  if (!clerkUserId) {
    res.status(401).json({
      error: "Sesión no verificada. Inicia sesión con Clerk para continuar.",
    });
    return;
  }

  // SECURITY: If the body sends a clerkId, it MUST match the JWT.
  if (bodyClerkId && bodyClerkId !== clerkUserId) {
    res.status(403).json({ error: "ID de sesión no coincide" });
    return;
  }

  if (!acceptTerms) {
    res.status(400).json({ error: "Debes aceptar los Términos y la Política de Privacidad" });
    return;
  }

  const resolvedClerkId = clerkUserId;

  if (!name || !email || !role) {
    res.status(400).json({ error: "Nombre, email y rol son requeridos" });
    return;
  }

  if (!(USER_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({ error: "Rol inválido" });
    return;
  }

  // Validate invitation code and determine approval status
  let approvalStatus: "pending" | "approved" = "pending";
  let invitationRecord: typeof invitationCodesTable.$inferSelect | null = null;

  if (invitationCode) {
    const upperCode = invitationCode.toUpperCase();

    if (isMasterAdminKey(upperCode)) {
      // Master admin key — auto approve as admin
      if (role !== "admin") {
        res.status(400).json({ error: "La clave CASTORES es solo para administradores" });
        return;
      }
      approvalStatus = "approved";
    } else {
      // Check generated invitation codes
      const [inv] = await db.select().from(invitationCodesTable)
        .where(and(eq(invitationCodesTable.code, upperCode), eq(invitationCodesTable.isActive, true)));

      if (!inv || inv.usedBy) {
        res.status(400).json({ error: "Código de invitación inválido o ya utilizado" });
        return;
      }
      if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
        res.status(400).json({ error: "El código de invitación ha expirado" });
        return;
      }
      if (inv.role !== role) {
        res.status(400).json({ error: `Este código es para el rol: ${inv.role}` });
        return;
      }
      approvalStatus = "approved";
      invitationRecord = inv;
    }
  }

  // Check if already registered by clerkId or email
  const conditions = resolvedClerkId
    ? or(eq(usersTable.clerkId, resolvedClerkId), eq(usersTable.email, email))
    : eq(usersTable.email, email);

  const existing = await db.select().from(usersTable).where(conditions);

  if (existing.length > 0) {
    let row = existing[0];
    if (row.email !== email) {
      res.status(409).json({ error: "Conflicto de cuenta: el correo no coincide con el registro existente." });
      return;
    }
    // If the existing row has a different clerkId, re-link to the new one.
    // Clerk only issues a JWT after verifying the email belongs to the user,
    // so it's safe to update the link (e.g. user deleted and recreated their
    // Clerk account, switched providers, etc.).
    if (!row.clerkId || row.clerkId !== resolvedClerkId) {
      const [linked] = await db
        .update(usersTable)
        .set({ clerkId: resolvedClerkId, updatedAt: new Date() })
        .where(eq(usersTable.id, row.id))
        .returning();
      if (linked) row = linked;
    }

    // Recovery path: when a previously registered email signs up again with a
    // valid invitation (or master key), enforce the invited role and make sure
    // the account is active/approved so first-time bootstrap login always works.
    if (invitationCode && (row.role !== role || row.approvalStatus !== "approved" || !row.isActive)) {
      const [recovered] = await db
        .update(usersTable)
        .set({
          role,
          approvalStatus: "approved",
          isActive: true,
          termsAcceptedAt: new Date(),
          termsVersion: termsVersion || row.termsVersion || "1.0",
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, row.id))
        .returning();
      if (recovered) row = recovered;
    }

    if (invitationRecord && !invitationRecord.usedBy) {
      await db
        .update(invitationCodesTable)
        .set({ usedBy: row.id, usedAt: new Date(), isActive: false })
        .where(eq(invitationCodesTable.id, invitationRecord.id));
    }
    const { passwordHash: _, ...safe } = row;
    res.json(safe);
    return;
  }

  const [user] = await db.insert(usersTable).values({
    clerkId: resolvedClerkId,
    name,
    email,
    role,
    company: company || null,
    phone: phone || null,
    isActive: true,
    approvalStatus,
    termsAcceptedAt: new Date(),
    termsVersion: termsVersion || "1.0",
  }).returning();

  const { passwordHash: _, ...safeUser } = user;

  // Mark invitation as used
  if (invitationRecord) {
    await db.update(invitationCodesTable)
      .set({ usedBy: user.id, usedAt: new Date(), isActive: false })
      .where(eq(invitationCodesTable.id, invitationRecord.id));
  }

  // Notify admins only if pending approval
  if (approvalStatus === "pending") {
    db.select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"))
      .then((admins) => {
        admins.forEach((admin) => {
          sendNewRegistrationEmail({
            adminEmail: admin.email,
            userName: safeUser.name,
            userEmail: safeUser.email,
            role: safeUser.role,
            company: safeUser.company,
            userId: safeUser.id,
          }).catch(() => {});
        });
      })
      .catch(() => {});
  }

  res.status(201).json(safeUser);
});

/* ─── Test endpoint — send a test email to verify configuration ───
 * Admin-only. Anyone could previously hit this endpoint to spam any email
 * address with a "welcome" message via our SES/Resend account. Now requires a
 * Clerk JWT belonging to an admin user before the email leaves. */
router.post("/auth/test-email", async (req, res): Promise<void> => {
  let clerkUserId: string | null = null;
  try { clerkUserId = getAuth(req).userId ?? null; } catch { /* ignore */ }
  if (!clerkUserId) { res.status(401).json({ error: "No autenticado" }); return; }
  const [actor] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!actor || actor.role !== "admin" || !actor.isActive) {
    res.status(403).json({ error: "Solo administradores pueden enviar correos de prueba" });
    return;
  }

  const { to } = req.body as { to?: string };
  if (!to) { res.status(400).json({ error: "Falta campo 'to'" }); return; }

  try {
    await sendWelcomeEmail({ to, name: "Usuario de Prueba", role: "worker" });
    res.json({ ok: true, message: `Email de prueba enviado a ${to}` });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Upsert the Clerk-authenticated user in our DB as soon as the session is
 * detected — called fire-and-forget from the complete-profile page so a DB
 * record always exists before the user enters their invitation code.
 * If the record already exists it is returned unchanged (only clerkId is
 * re-linked if it drifted). New records get role="worker" / approvalStatus=
 * "pending" / isActive=false as a placeholder; admin-access or clerk-register
 * will promote/update them later.
 */
router.post("/auth/clerk-me", async (req, res): Promise<void> => {
  let clerkUserId: string | null = null;
  try {
    clerkUserId = getAuth(req).userId ?? null;
  } catch (authErr: unknown) {
    const detail = authErr instanceof Error ? authErr.message : String(authErr);
    logger.error({ detail }, "getAuth error in clerk-me");
    res.status(503).json({ error: "auth_unavailable", detail });
    return;
  }
  if (!clerkUserId) {
    res.status(401).json({ error: "Sesión no verificada" });
    return;
  }

  const verifiedEmail = getVerifiedEmail(req);
  if (!verifiedEmail) {
    res.status(400).json({ error: "No se pudo verificar el correo de la sesión Clerk" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(usersTable)
      .where(or(eq(usersTable.clerkId, clerkUserId), eq(usersTable.email, verifiedEmail)));

    if (rows.length > 0) {
      let user = rows[0];
      if (!user.clerkId || user.clerkId !== clerkUserId) {
        const [linked] = await db
          .update(usersTable)
          .set({ clerkId: clerkUserId, updatedAt: new Date() })
          .where(eq(usersTable.id, user.id))
          .returning();
        if (linked) user = linked;
      }
      req.session.userId = user.id;
      const { passwordHash: _, ...safeUser } = user;
      res.json(safeUser);
      return;
    }

    const { name: bodyName } = req.body as { name?: string };
    const [user] = await db
      .insert(usersTable)
      .values({
        clerkId: clerkUserId,
        name: bodyName?.trim() || "Usuario Nuevo",
        email: verifiedEmail,
        role: "worker",
        isActive: false,
        approvalStatus: "pending",
      })
      .returning();

    req.session.userId = user.id;
    const { passwordHash: _, ...safeUser } = user;
    res.status(201).json(safeUser);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "db_error";
    logger.error({ err, msg }, "clerk-me db error");
    res.status(503).json({ error: "Sin conexión a la base de datos", detail: msg });
  }
});

/**
 * Returns the current Clerk user's DB record + approval status.
 * Also establishes the server session so later protected API calls work
 * through the session cookie.
 */
router.get("/auth/clerk-me", async (req, res): Promise<void> => {
  let jwtUserId: string | null = null;
  try {
    jwtUserId = getAuth(req).userId ?? null;
  } catch (authErr: unknown) {
    const detail = authErr instanceof Error ? authErr.message : String(authErr);
    logger.error({ detail }, "getAuth error in GET clerk-me");
    res.status(503).json({ error: "auth_unavailable", detail });
    return;
  }
  if (!jwtUserId) {
    res.status(401).json({ error: "Sesión no verificada" });
    return;
  }

  const rows = await db.select().from(usersTable).where(eq(usersTable.clerkId, jwtUserId));
  const user = rows[0];

  if (!user) {
    res.status(404).json({ error: "not_registered" });
    return;
  }

  // Establish server-side session for Clerk users so subsequent API calls
  // (invitations, role-permissions, notifications, etc.) can authenticate
  // via session cookie without needing query params.
  req.session.userId = user.id;

  const { passwordHash: _, ...safeUser } = user;
  res.json(safeUser);
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Error destroying session");
    }
  });
  res.json({ success: true });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const userId = req.session.userId;

  if (!userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  if (!user) {
    res.status(401).json({ error: "Usuario no encontrado" });
    return;
  }

  const { passwordHash: _, ...safeUser } = user;
  res.json(safeUser);
});

/**
 * Returns the current user's role + the full permission map the backend
 * actually applies. The frontend uses this to drive role-aware UI: hiding
 * sidebar items, disabling buttons, gating routes — all using exactly the
 * same source of truth the backend uses to authorise requests. Without this
 * the frontend was showing "Crear obra" / "Aprobar material" buttons that
 * any authenticated role could see and the backend would just reject when
 * clicked.
 */
router.get("/auth/me-permissions", async (req, res): Promise<void> => {
  const { getEffectivePermissions } = await import("../lib/permissions");
  let user: typeof usersTable.$inferSelect | null = null;

  // Resolve the current user via session OR via Clerk JWT, whichever is
  // available. The frontend expects this endpoint to work in both early
  // (Clerk-only) and steady (cookie-session) phases.
  const sessionUserId = req.session.userId;
  if (sessionUserId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, sessionUserId));
    user = u ?? null;
  }
  if (!user) {
    let clerkUserId: string | null = null;
    try { clerkUserId = getAuth(req).userId ?? null; } catch { /* ignore */ }
    if (clerkUserId) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
      user = u ?? null;
    }
  }
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const permissions = await getEffectivePermissions(user.role);
  res.json({
    userId: user.id,
    role: user.role,
    isActive: user.isActive,
    approvalStatus: user.approvalStatus,
    permissions,
  });
});

export default router;
