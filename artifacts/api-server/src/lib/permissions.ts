import { eq } from "drizzle-orm";
import { db, rolePermissionsTable, ROLE_DEFAULTS } from "@workspace/db";
import type { PermissionKey } from "@workspace/db";

// TTL cache: avoids a DB round-trip on every request while letting
// permission changes propagate within ~60 seconds.
const cache = new Map<string, { permissions: Record<string, boolean>; expiresAt: number }>();
const TTL_MS = 60_000;

async function getRolePermissions(role: string): Promise<Record<string, boolean>> {
  const now = Date.now();
  const cached = cache.get(role);
  if (cached && cached.expiresAt > now) return cached.permissions;

  const [row] = await db
    .select({ permissions: rolePermissionsTable.permissions })
    .from(rolePermissionsTable)
    .where(eq(rolePermissionsTable.role, role));

  const permissions =
    row?.permissions ??
    (ROLE_DEFAULTS[role] as Record<string, boolean> | undefined) ??
    {};
  cache.set(role, { permissions, expiresAt: now + TTL_MS });
  return permissions;
}

/** Returns true if the given role has the given permission enabled. */
export async function hasPermission(role: string, key: PermissionKey): Promise<boolean> {
  if (role === "admin") return true; // admin always has all permissions
  const permissions = await getRolePermissions(role);
  return permissions[key] === true;
}

/** Call after PUT /role-permissions or POST /role-permissions/reset to flush cache. */
export function clearPermissionsCache(role?: string): void {
  if (role) cache.delete(role);
  else cache.clear();
}
