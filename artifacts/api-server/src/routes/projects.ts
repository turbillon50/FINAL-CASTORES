import { Router, type IRouter } from "express";
import { eq, sql, and } from "drizzle-orm";
import { db, projectsTable, usersTable, workLogsTable, materialsTable, projectAssignmentsTable, documentsTable, reportsTable } from "@workspace/db";
import { getRequestUser, getRequestUserStrict } from "../lib/getRequestUser";
import { getAccessibleProjectIds, canAccessProject } from "../lib/projectAccess";
import { hasPermission } from "../lib/permissions";
import { isAdmin, logAdminOverride } from "../lib/adminOverride";
import { formatZodError } from "../lib/zodError";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
  ListProjectsQueryParams,
  GetProjectProgressParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function enrichProject(project: typeof projectsTable.$inferSelect) {
  const [client] = project.clientId
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, project.clientId))
    : [null];
  const [supervisor] = project.supervisorId
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, project.supervisorId))
    : [null];

  return {
    ...project,
    clientName: client?.name ?? null,
    supervisorName: supervisor?.name ?? null,
  };
}

router.get("/projects", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const parsed = ListProjectsQueryParams.safeParse(req.query);
  let projects = await db.select().from(projectsTable).orderBy(projectsTable.createdAt);

  const accessibleIds = await getAccessibleProjectIds(user);
  if (accessibleIds !== null) {
    if (accessibleIds.length === 0) { res.json([]); return; }
    projects = projects.filter((p) => accessibleIds.includes(p.id));
  }

  if (parsed.success) {
    if (parsed.data.status) projects = projects.filter((p) => p.status === parsed.data.status);
    if (parsed.data.clientId) projects = projects.filter((p) => p.clientId === parsed.data.clientId);
  }

  const enriched = await Promise.all(projects.map(enrichProject));
  res.json(enriched);
});

router.post("/projects", async (req, res): Promise<void> => {
  const user = await getRequestUserStrict(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!await hasPermission(user.role, "projectsCreateEdit")) {
    res.status(403).json({ error: "No tienes permiso para crear obras" });
    return;
  }

  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const [project] = await db.insert(projectsTable).values(parsed.data).returning();
  res.status(201).json(await enrichProject(project));
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await canAccessProject(user, params.data.id))) {
    res.status(403).json({ error: "No tienes acceso a esta obra" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Proyecto no encontrado" });
    return;
  }

  res.json(await enrichProject(project));
});

// ─── Project Assignments (admin-only) ───────────────────────────────────────
router.get("/projects/:id/assignments", async (req, res): Promise<void> => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "ID inválido" }); return;
  }

  const user = await getRequestUserStrict(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!await hasPermission(user.role, "workersManage")) {
    res.status(403).json({ error: "No tienes permiso para ver asignaciones" }); return;
  }

  const rows = await db
    .select({
      id: projectAssignmentsTable.id,
      userId: projectAssignmentsTable.userId,
      createdAt: projectAssignmentsTable.createdAt,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
    })
    .from(projectAssignmentsTable)
    .leftJoin(usersTable, eq(projectAssignmentsTable.userId, usersTable.id))
    .where(eq(projectAssignmentsTable.projectId, projectId));

  res.json(rows);
});

router.post("/projects/:id/assignments", async (req, res): Promise<void> => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    res.status(400).json({ error: "ID inválido" }); return;
  }

  const user = await getRequestUserStrict(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!await hasPermission(user.role, "workersManage")) {
    res.status(403).json({ error: "No tienes permiso para asignar usuarios" }); return;
  }

  const userId = Number((req.body as { userId?: unknown })?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "userId requerido" }); return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!target) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Obra no encontrada" }); return; }

  try {
    const [created] = await db
      .insert(projectAssignmentsTable)
      .values({ projectId, userId, assignedBy: user.id })
      .returning();
    res.status(201).json(created);
  } catch (e: any) {
    // Postgres unique_violation
    if (e?.code === "23505" || String(e?.message ?? "").toLowerCase().includes("unique")) {
      res.status(409).json({ error: "Este usuario ya está asignado a la obra" });
      return;
    }
    throw e;
  }
});

router.delete("/projects/:id/assignments/:userId", async (req, res): Promise<void> => {
  const projectId = Number(req.params.id);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "ID inválido" }); return;
  }

  const user = await getRequestUserStrict(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!await hasPermission(user.role, "workersManage")) {
    res.status(403).json({ error: "No tienes permiso para remover asignaciones" }); return;
  }

  await db
    .delete(projectAssignmentsTable)
    .where(and(eq(projectAssignmentsTable.projectId, projectId), eq(projectAssignmentsTable.userId, userId)));

  res.sendStatus(204);
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const user = await getRequestUserStrict(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!await hasPermission(user.role, "projectsCreateEdit")) {
    res.status(403).json({ error: "No tienes permiso para editar obras" });
    return;
  }

  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== null && v !== undefined) data[k] = v;
  }

  const [project] = await db
    .update(projectsTable)
    .set(data)
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Proyecto no encontrado" });
    return;
  }

  res.json(await enrichProject(project));
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const user = await getRequestUserStrict(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  // Eliminar obras es destructivo y arrastra bitácoras + materiales +
  // documentos + reportes. Lo restringimos a admin (incluso si el rol
  // tiene projectsCreateEdit, no puede borrar). El admin sí — y queda
  // grabado en activity_log para que siempre se sepa qué desapareció.
  if (!isAdmin(user)) {
    res.status(403).json({ error: "Solo el administrador puede eliminar obras" });
    return;
  }

  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const projectId = params.data.id;

  // Snapshot pre-borrado para que el audit log diga qué se llevó por
  // delante (nombre + conteos).
  const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!existing) { res.status(404).json({ error: "Obra no encontrada" }); return; }

  const logsCount = (await db.select({ id: workLogsTable.id }).from(workLogsTable).where(eq(workLogsTable.projectId, projectId))).length;
  const materialsCount = (await db.select({ id: materialsTable.id }).from(materialsTable).where(eq(materialsTable.projectId, projectId))).length;
  const docsCount = (await db.select({ id: documentsTable.id }).from(documentsTable).where(eq(documentsTable.projectId, projectId))).length;

  // Cleanup explícito antes del DELETE del project para no dejar filas
  // huérfanas con projectId apuntando a un id que ya no existe.
  await db.delete(workLogsTable).where(eq(workLogsTable.projectId, projectId));
  await db.delete(materialsTable).where(eq(materialsTable.projectId, projectId));
  await db.delete(documentsTable).where(eq(documentsTable.projectId, projectId));
  await db.delete(reportsTable).where(eq(reportsTable.projectId, projectId));
  await db.delete(projectAssignmentsTable).where(eq(projectAssignmentsTable.projectId, projectId));
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));

  await logAdminOverride({
    actorId: user.id,
    action: "project.delete",
    description: `Admin ${user.name} eliminó la obra "${existing.name}" (#${existing.id}) y su contenido: ${logsCount} bitácoras, ${materialsCount} materiales, ${docsCount} documentos`,
    projectId,
  });

  res.sendStatus(204);
});

router.get("/projects/:id/progress", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const params = GetProjectProgressParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (!(await canAccessProject(user, params.data.id))) {
    res.status(403).json({ error: "No tienes acceso a esta obra" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Proyecto no encontrado" });
    return;
  }

  const logs = await db.select({ id: workLogsTable.id }).from(workLogsTable).where(eq(workLogsTable.projectId, params.data.id));
  const materials = await db.select().from(materialsTable).where(eq(materialsTable.projectId, params.data.id));
  const materialCost = materials.reduce((sum, m) => sum + (m.totalCost ?? (m.costPerUnit ?? 0) * m.quantityRequested), 0);

  let daysElapsed: number | null = null;
  let daysRemaining: number | null = null;
  let budgetUsedPercent: number | null = null;

  if (project.startDate) {
    const start = new Date(project.startDate);
    const now = new Date();
    daysElapsed = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000));
    if (project.endDate) {
      const end = new Date(project.endDate);
      daysRemaining = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 86400000));
    }
  }

  if (project.budget && project.budget > 0) {
    budgetUsedPercent = Math.round(((project.spentAmount ?? materialCost) / project.budget) * 100);
  }

  res.json({
    projectId: project.id,
    progressPercent: project.progressPercent,
    totalLogs: logs.length,
    totalMaterials: materials.length,
    materialCost,
    budget: project.budget ?? null,
    budgetUsedPercent,
    daysElapsed,
    daysRemaining,
  });
});

export default router;
