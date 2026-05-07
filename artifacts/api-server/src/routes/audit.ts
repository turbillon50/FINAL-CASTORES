import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { db, activityLogTable, usersTable, projectsTable } from "@workspace/db";
import { resolveAuthedUser } from "../lib/authContext";
import { isAdmin } from "../lib/adminOverride";

const router: IRouter = Router();

router.get("/admin/audit-log", async (req, res): Promise<void> => {
  const actor = await resolveAuthedUser(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!isAdmin(actor)) {
    res.status(403).json({ error: "Solo el administrador puede consultar la auditoría" });
    return;
  }

  const limit = Math.min(200, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));
  const offset = Math.max(0, parseInt(String(req.query["offset"] ?? "0"), 10) || 0);
  const typeFilter = typeof req.query["type"] === "string" ? String(req.query["type"]) : null;
  const projectIdFilter = req.query["projectId"] ? Number(req.query["projectId"]) : null;
  const userIdFilter = req.query["userId"] ? Number(req.query["userId"]) : null;
  const dateFrom = typeof req.query["dateFrom"] === "string" ? new Date(String(req.query["dateFrom"])) : null;
  const dateTo = typeof req.query["dateTo"] === "string" ? new Date(String(req.query["dateTo"])) : null;

  const conds = [];
  if (typeFilter) conds.push(eq(activityLogTable.type, typeFilter));
  if (projectIdFilter && Number.isFinite(projectIdFilter)) conds.push(eq(activityLogTable.projectId, projectIdFilter));
  if (userIdFilter && Number.isFinite(userIdFilter)) conds.push(eq(activityLogTable.userId, userIdFilter));
  if (dateFrom && !Number.isNaN(dateFrom.getTime())) conds.push(gte(activityLogTable.createdAt, dateFrom));
  if (dateTo && !Number.isNaN(dateTo.getTime())) conds.push(lte(activityLogTable.createdAt, dateTo));

  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select()
    .from(activityLogTable)
    .where(where)
    .orderBy(desc(activityLogTable.createdAt))
    .limit(limit)
    .offset(offset);

  const totalRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activityLogTable)
    .where(where);
  const total = totalRow[0]?.count ?? 0;

  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is number => v != null))];
  const projectIds = [...new Set(rows.map((r) => r.projectId).filter((v): v is number => v != null))];
  const [users, projects] = await Promise.all([
    userIds.length
      ? db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role }).from(usersTable).where(inArray(usersTable.id, userIds))
      : Promise.resolve([] as { id: number; name: string; role: string }[]),
    projectIds.length
      ? db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(inArray(projectsTable.id, projectIds))
      : Promise.resolve([] as { id: number; name: string }[]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  res.json({
    total,
    limit,
    offset,
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description,
      userId: r.userId,
      userName: r.userId ? userMap.get(r.userId)?.name ?? null : null,
      userRole: r.userId ? userMap.get(r.userId)?.role ?? null : null,
      projectId: r.projectId,
      projectName: r.projectId ? projectMap.get(r.projectId) ?? null : null,
      createdAt: r.createdAt,
    })),
  });
});

router.get("/admin/audit-log/types", async (req, res): Promise<void> => {
  const actor = await resolveAuthedUser(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!isAdmin(actor)) { res.status(403).json({ error: "Solo el administrador" }); return; }

  const rows = await db
    .selectDistinct({ type: activityLogTable.type })
    .from(activityLogTable);
  res.json(rows.map((r) => r.type).sort());
});

export default router;
