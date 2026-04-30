import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, rolePermissionsTable, ROLE_DEFAULTS, PERMISSION_KEYS, USER_ROLES } from "@workspace/db";
import { getRequestUser } from "../lib/getRequestUser";
import { clearPermissionsCache } from "../lib/permissions";

const router: IRouter = Router();

const ROLES = USER_ROLES;

async function ensureSeeded(): Promise<void> {
  const existing = await db.select({ role: rolePermissionsTable.role }).from(rolePermissionsTable);
  const existingRoles = new Set(existing.map((r) => r.role));
  const missing = ROLES.filter((r) => !existingRoles.has(r));
  if (missing.length === 0) return;
  await db.insert(rolePermissionsTable).values(
    missing.map((role) => ({ role, permissions: ROLE_DEFAULTS[role] }))
  );
}

// GET /role-permissions — admin only — returns matrix of all roles
router.get("/role-permissions", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }
  await ensureSeeded();
  const rows = await db.select().from(rolePermissionsTable);
  const byRole: Record<string, Record<string, boolean>> = {};
  for (const r of rows) byRole[r.role] = r.permissions;
  // Ensure all expected roles present even after seeding race
  for (const r of ROLES) if (!byRole[r]) byRole[r] = ROLE_DEFAULTS[r];
  res.json(byRole);
});

// PUT /role-permissions/:role — admin only — replace permissions for one role
router.put("/role-permissions/:role", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }
  const role = req.params.role;
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    res.status(400).json({ error: "Rol inválido" });
    return;
  }
  // SAFETY: admin role always retains all permissions (cannot be downgraded)
  if (role === "admin") {
    res.status(400).json({ error: "El rol Administrador no se puede modificar (siempre tiene todos los permisos)" });
    return;
  }
  const incoming = (req.body?.permissions ?? {}) as Record<string, unknown>;
  const sanitized: Record<string, boolean> = {};
  for (const k of PERMISSION_KEYS) sanitized[k] = Boolean(incoming[k]);

  await ensureSeeded();
  await db.update(rolePermissionsTable)
    .set({ permissions: sanitized, updatedAt: new Date() })
    .where(eq(rolePermissionsTable.role, role));

  clearPermissionsCache(role);
  res.json({ role, permissions: sanitized });
});

// POST /role-permissions/reset — admin only — reset to factory defaults
router.post("/role-permissions/reset", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }
  for (const role of ROLES) {
    await db.insert(rolePermissionsTable)
      .values({ role, permissions: ROLE_DEFAULTS[role] })
      .onConflictDoUpdate({
        target: rolePermissionsTable.role,
        set: { permissions: ROLE_DEFAULTS[role], updatedAt: new Date() },
      });
  }
  clearPermissionsCache();
  res.json({ ok: true });
});

export default router;
