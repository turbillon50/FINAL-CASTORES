import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db, reportsTable, projectsTable, usersTable, workLogsTable, materialsTable } from "@workspace/db";
import { getRequestUser } from "../lib/getRequestUser";
import { getAccessibleProjectIds, canAccessProject } from "../lib/projectAccess";
import { formatZodError } from "../lib/zodError";
import {
  CreateReportBody,
  GetReportParams,
  ListReportsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function enrichReport(r: typeof reportsTable.$inferSelect) {
  const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, r.projectId));
  const [gen] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.generatedById));
  return {
    ...r,
    projectName: project?.name ?? null,
    generatedByName: gen?.name ?? null,
  };
}

router.get("/reports", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const parsed = ListReportsQueryParams.safeParse(req.query);
  let reports = await db.select().from(reportsTable).orderBy(reportsTable.createdAt);

  const accessibleIds = await getAccessibleProjectIds(user);
  if (accessibleIds !== null) {
    if (accessibleIds.length === 0) { res.json([]); return; }
    reports = reports.filter((r) => accessibleIds.includes(r.projectId));
  }

  if (parsed.success) {
    if (parsed.data.projectId) reports = reports.filter((r) => r.projectId === parsed.data.projectId);
    if (parsed.data.type) reports = reports.filter((r) => r.type === parsed.data.type);
  }

  res.json(await Promise.all(reports.map(enrichReport)));
});

router.post("/reports", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (user.role !== "admin" && user.role !== "supervisor") {
    res.status(403).json({ error: "Solo administradores o supervisores pueden generar reportes" });
    return;
  }

  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const typeLabels: Record<string, string> = {
    avance: "Avance de Obra",
    bitacora: "Bitácora de Trabajo",
    materiales: "Control de Materiales",
  };
  const typeLabel = typeLabels[parsed.data.type] ?? parsed.data.type;

  const [report] = await db
    .insert(reportsTable)
    .values({
      ...parsed.data,
      generatedById: user.id,
      summary: `Reporte de ${typeLabel} generado el ${new Date().toLocaleDateString("es-MX")} por usuario #${user.id}`,
    })
    .returning();

  res.status(201).json(await enrichReport(report));
});

router.get("/reports/:id", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const params = GetReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, params.data.id));
  if (!report) {
    res.status(404).json({ error: "Reporte no encontrado" });
    return;
  }

  if (!(await canAccessProject(user, report.projectId))) {
    res.status(403).json({ error: "No tienes acceso a este reporte" });
    return;
  }

  res.json(await enrichReport(report));
});

// ─── GET /reports/:id/data — aggregate real data for PDF generation ───────────
router.get("/reports/:id/data", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Reporte no encontrado" }); return; }

  if (!(await canAccessProject(user, report.projectId))) {
    res.status(403).json({ error: "No tienes acceso a este reporte" });
    return;
  }

  // Project info
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, report.projectId));
  const [generatedBy] = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, report.generatedById));

  let clientName: string | null = null;
  let supervisorName: string | null = null;
  if (project?.clientId) {
    const [c] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, project.clientId));
    clientName = c?.name ?? null;
  }
  if (project?.supervisorId) {
    const [s] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, project.supervisorId));
    supervisorName = s?.name ?? null;
  }

  // Date filters
  const dateFrom = report.dateFrom;
  const dateTo = report.dateTo;

  // Work logs for this project
  let logsQuery = db.select({
    id: workLogsTable.id,
    logDate: workLogsTable.logDate,
    activity: workLogsTable.activity,
    observations: workLogsTable.observations,
    workersInvolved: workLogsTable.workersInvolved,
    materialsUsed: workLogsTable.materialsUsed,
    isSubmitted: workLogsTable.isSubmitted,
  }).from(workLogsTable).where(eq(workLogsTable.projectId, report.projectId));

  const logs = (await logsQuery).filter((l) => {
    if (dateFrom && l.logDate < dateFrom) return false;
    if (dateTo && l.logDate > dateTo) return false;
    return true;
  });

  // Materials for this project
  const allMaterials = await db.select().from(materialsTable).where(eq(materialsTable.projectId, report.projectId));
  const materials = allMaterials.filter((m) => {
    const d = m.createdAt.toISOString().split("T")[0];
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  // Totals
  const totalMaterialCost = materials.reduce((s, m) => s + (m.totalCost ?? 0), 0);
  const approvedMaterials = materials.filter((m) => m.status === "approved");
  const pendingMaterials = materials.filter((m) => m.status === "pending");
  const rejectedMaterials = materials.filter((m) => m.status === "rejected");

  res.json({
    report: {
      ...report,
      projectName: project?.name ?? null,
      generatedByName: generatedBy?.name ?? null,
    },
    project: project
      ? {
          ...project,
          clientName,
          supervisorName,
        }
      : null,
    logs,
    materials,
    summary: {
      totalLogs: logs.length,
      totalMaterials: materials.length,
      approvedMaterials: approvedMaterials.length,
      pendingMaterials: pendingMaterials.length,
      rejectedMaterials: rejectedMaterials.length,
      totalMaterialCost,
      progressPercent: project?.progressPercent ?? 0,
      budget: project?.budget ?? null,
      spentAmount: project?.spentAmount ?? 0,
    },
  });
});

export default router;
