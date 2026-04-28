import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  projectsTable,
  usersTable,
  materialsTable,
  workLogsTable,
  notificationsTable,
  activityLogTable,
  projectAssignmentsTable,
} from "@workspace/db";
import { resolveAuthedUser } from "../lib/authContext";
import { getAccessibleProjectIds } from "../lib/projectAccess";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const accessibleIds = await getAccessibleProjectIds(user);

  let projects: { status: string | null; budget: number | null; spentAmount: number | null }[];
  let materials: { status: string | null }[];
  let usersForRoles: { role: string }[];

  if (accessibleIds === null) {
    projects = await db
      .select({ status: projectsTable.status, budget: projectsTable.budget, spentAmount: projectsTable.spentAmount })
      .from(projectsTable);
    materials = await db.select({ status: materialsTable.status }).from(materialsTable);
    usersForRoles = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.isActive, true));
  } else if (accessibleIds.length === 0) {
    projects = [];
    materials = [];
    usersForRoles = [];
  } else {
    projects = await db
      .select({ status: projectsTable.status, budget: projectsTable.budget, spentAmount: projectsTable.spentAmount })
      .from(projectsTable)
      .where(inArray(projectsTable.id, accessibleIds));
    materials = await db
      .select({ status: materialsTable.status })
      .from(materialsTable)
      .where(inArray(materialsTable.projectId, accessibleIds));
    const assignRows = await db
      .select({ userId: projectAssignmentsTable.userId })
      .from(projectAssignmentsTable)
      .where(inArray(projectAssignmentsTable.projectId, accessibleIds));
    const clientRows = await db
      .select({ clientId: projectsTable.clientId })
      .from(projectsTable)
      .where(inArray(projectsTable.id, accessibleIds));
    const uidSet = new Set<number>();
    for (const r of assignRows) uidSet.add(r.userId);
    for (const r of clientRows) {
      if (r.clientId != null) uidSet.add(r.clientId);
    }
    const uids = [...uidSet];
    usersForRoles =
      uids.length > 0
        ? await db
            .select({ role: usersTable.role })
            .from(usersTable)
            .where(and(eq(usersTable.isActive, true), inArray(usersTable.id, uids)))
        : [];
  }

  const notifications = await db
    .select({ isRead: notificationsTable.isRead })
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, user.id));

  const today = new Date().toISOString().split("T")[0];
  let todayLogs: { id: number }[];
  if (accessibleIds === null) {
    todayLogs = await db.select({ id: workLogsTable.id }).from(workLogsTable).where(eq(workLogsTable.logDate, today));
  } else if (accessibleIds.length === 0) {
    todayLogs = [];
  } else {
    todayLogs = await db
      .select({ id: workLogsTable.id })
      .from(workLogsTable)
      .where(and(eq(workLogsTable.logDate, today), inArray(workLogsTable.projectId, accessibleIds)));
  }

  const activeProjects = projects.filter((p) => p.status === "active").length;
  const completedProjects = projects.filter((p) => p.status === "completed").length;
  const totalBudget = projects.reduce((sum, p) => sum + (p.budget ?? 0), 0);
  const totalSpent = projects.reduce((sum, p) => sum + (p.spentAmount ?? 0), 0);

  res.json({
    activeProjects,
    completedProjects,
    totalProjects: projects.length,
    totalWorkers: usersForRoles.filter((u) => u.role === "worker").length,
    totalSupervisors: usersForRoles.filter((u) => u.role === "supervisor").length,
    totalClients: usersForRoles.filter((u) => u.role === "client").length,
    pendingMaterialRequests: materials.filter((m) => m.status === "pending").length,
    unreadNotifications: notifications.filter((n) => !n.isRead).length,
    totalLogsToday: todayLogs.length,
    totalBudget,
    totalSpent,
  });
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const accessibleIds = await getAccessibleProjectIds(user);
  const limit = parseInt(String(req.query.limit ?? "20"), 10);

  let activities = await db.select().from(activityLogTable).orderBy(activityLogTable.createdAt).limit(limit * 3);

  if (accessibleIds !== null) {
    if (accessibleIds.length === 0) {
      activities = [];
    } else {
      activities = activities
        .filter((a) => a.projectId != null && accessibleIds.includes(a.projectId))
        .slice(0, limit);
    }
  } else {
    activities = activities.slice(0, limit);
  }

  const userIds = [...new Set(activities.map((a) => a.userId).filter(Boolean))] as number[];
  const projectIds = [...new Set(activities.map((a) => a.projectId).filter(Boolean))] as number[];

  const [users, projects] = await Promise.all([
    userIds.length > 0
      ? db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
      : Promise.resolve([]),
    projectIds.length > 0
      ? db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(inArray(projectsTable.id, projectIds))
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  res.json(
    activities.map((a) => ({
      ...a,
      userName: a.userId ? (userMap.get(a.userId) ?? null) : null,
      projectName: a.projectId ? (projectMap.get(a.projectId) ?? null) : null,
    })),
  );
});

router.get("/dashboard/material-stats", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const accessibleIds = await getAccessibleProjectIds(user);

  let materials: Array<typeof materialsTable.$inferSelect>;
  if (accessibleIds === null) {
    materials = await db.select().from(materialsTable);
  } else if (accessibleIds.length === 0) {
    materials = [];
  } else {
    materials = await db.select().from(materialsTable).where(inArray(materialsTable.projectId, accessibleIds));
  }

  const materialCostMap = new Map<string, { totalQuantity: number; totalCost: number; unit: string }>();
  for (const m of materials) {
    const existing = materialCostMap.get(m.name) ?? { totalQuantity: 0, totalCost: 0, unit: m.unit };
    materialCostMap.set(m.name, {
      totalQuantity: existing.totalQuantity + m.quantityRequested,
      totalCost: existing.totalCost + (m.totalCost ?? 0),
      unit: m.unit,
    });
  }

  const mostUsedMaterials = [...materialCostMap.entries()]
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 10);

  const monthlyMap = new Map<string, { totalCost: number; totalRequests: number }>();
  for (const m of materials) {
    const month = new Date(m.createdAt).toISOString().slice(0, 7);
    const existing = monthlyMap.get(month) ?? { totalCost: 0, totalRequests: 0 };
    monthlyMap.set(month, {
      totalCost: existing.totalCost + (m.totalCost ?? 0),
      totalRequests: existing.totalRequests + 1,
    });
  }

  const monthlyUsage = [...monthlyMap.entries()]
    .map(([month, stats]) => ({ month, ...stats }))
    .sort((a, b) => a.month.localeCompare(b.month));

  res.json({
    totalMaterialRequests: materials.length,
    pendingRequests: materials.filter((m) => m.status === "pending").length,
    approvedRequests: materials.filter((m) => m.status === "approved").length,
    totalMaterialCost: materials.reduce((sum, m) => sum + (m.totalCost ?? 0), 0),
    mostUsedMaterials,
    monthlyUsage,
  });
});

export default router;
