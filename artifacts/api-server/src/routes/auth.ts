import { Router, type IRouter } from "express";
import { eq, or } from "drizzle-orm";
import { db, usersTable, invitationCodesTable, USER_ROLES } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import { sendNewRegistrationEmail, sendWelcomeEmail } from "../lib/email";
import { and } from "drizzle-orm";

const ADMIN_MASTER_KEY = "CASTORES";

const router: IRouter = Router();

// Demo login — no password for demo roles, admin uses "castores2024"
router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email) {
    res.status(400).json({ error: "Email requerido" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  if (!user) {
    res.status(401).json({ error: "Usuario no encontrado" });
    return;
  }

  if (!user.isActive) {
    res.status(401).json({ error: "Usuario inactivo" });
    return;
  }

  // Admin requires password
  if (user.role === "admin" && password !== "castores2024") {
    res.status(401).json({ error: "Contraseña incorrecta" });
    return;
  }

  req.session.userId = user.id;

  const { passwordHash: _, ...safeUser } = user;
  res.json({
    user: safeUser,
    token: `demo-token-${user.id}`,
  });
});

/**
 * Called right after Clerk signup to create the user in our DB as "pending".
 * Body: { name, email, role, company?, phone?, clerkId? }
 * The clerkId from the body is used as fallback if JWT validation is unavailable (dev mode).
 */
router.post("/auth/clerk-register", async (req, res): Promise<void> => {
  const { userId: clerkUserId } = getAuth(req);

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

    if (upperCode === ADMIN_MASTER_KEY) {
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

/* ─── Test endpoint — send a test email to verify configuration ─── */
router.post("/auth/test-email", async (req, res): Promise<void> => {
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
 * Returns the current Clerk user's DB record + approval status.
 * Also establishes the server session so later protected API calls work
 * through the session cookie.
 */
router.get("/auth/clerk-me", async (req, res): Promise<void> => {
  const { userId: jwtUserId } = getAuth(req);
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

export default router;
