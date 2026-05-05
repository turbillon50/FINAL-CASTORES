import { db, activityLogTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Admin = el dueño del habitáculo: puede tocar cualquier registro,
 * incluso bitácoras ya enviadas y obras en cualquier estado. Cada vez
 * que admin usa este permiso por encima de un lock que aplicaría a
 * otros roles, escribimos a activity_log para que siempre exista
 * trazabilidad ("quién tachó qué") aunque el admin tenga libertad
 * total de hacerlo.
 */
export function isAdmin(user: { role?: string | null } | null | undefined): boolean {
  return !!user && user.role === "admin";
}

export type AdminOverrideEvent = {
  actorId: number;
  action: string; // p.ej. "log.edit_after_submit", "log.delete", "project.delete"
  description: string;
  projectId?: number | null;
};

/**
 * Fire-and-forget: nunca propaga errores. Si la inserción falla,
 * loguea pero no rompe el flujo HTTP que le dio origen — el
 * registro de auditoría es deseable, no bloqueante.
 */
export async function logAdminOverride(ev: AdminOverrideEvent): Promise<void> {
  try {
    await db.insert(activityLogTable).values({
      type: ev.action,
      description: ev.description,
      userId: ev.actorId,
      projectId: ev.projectId ?? null,
    });
  } catch (err) {
    logger.warn({ err, ev }, "audit: failed to write admin override entry");
  }
}
