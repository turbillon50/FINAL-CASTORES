import { Router, type IRouter } from "express";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { db, reportsTable, projectsTable, usersTable, workLogsTable, materialsTable, materialNotesTable, checkInsTable } from "@workspace/db";
import { getRequestUser } from "../lib/getRequestUser";
import { getAccessibleProjectIds, canAccessProject } from "../lib/projectAccess";
import { hasPermission } from "../lib/permissions";
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

  if (!(await canAccessProject(user, parsed.data.projectId))) {
    res.status(403).json({ error: "No tienes acceso a esta obra" });
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

  // Totals: el "gastado" del reporte SOLO contabiliza materiales aprobados.
  // Pendientes y rechazados se cuentan aparte para visibilidad pero no inflan
  // el costo del PDF (que de otro modo mostraría dinero que nunca se autorizó).
  const approvedMaterials = materials.filter((m) => m.status === "approved");
  const pendingMaterials = materials.filter((m) => m.status === "pending");
  const rejectedMaterials = materials.filter((m) => m.status === "rejected");
  const totalMaterialCost = approvedMaterials.reduce((s, m) => s + (m.totalCost ?? 0), 0);
  const pendingMaterialCost = pendingMaterials.reduce((s, m) => s + (m.totalCost ?? 0), 0);

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
      pendingMaterialCost,
      progressPercent: project?.progressPercent ?? 0,
      budget: project?.budget ?? null,
      spentAmount: project?.spentAmount ?? 0,
    },
  });
});

// ─── POST /reports/builder — agregación configurable multi-obra ───────────────
// Motor del "Constructor inteligente" del panel admin. A diferencia de los 3
// reportes fijos, aquí el admin elige qué fuentes incluir (obra, bitácora,
// materiales, asistencia), una o varias obras (o todas), y un rango de fechas;
// devolvemos métricas ya agregadas y series listas para graficar (recharts) sin
// persistir nada — se genera al vuelo. Respeta projectAccess: aunque la UI lo
// muestra solo en modo admin, el server vuelve a filtrar por obras accesibles.
router.post("/reports/builder", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(user.role, "adminPanelAccess"))) {
    res.status(403).json({ error: "Solo el panel administrativo puede generar reportes configurables" });
    return;
  }

  // Validación manual (el body es simple) para no acoplar a una versión de zod.
  const body = (req.body ?? {}) as Record<string, unknown>;
  const dateFrom = typeof body.dateFrom === "string" && body.dateFrom ? body.dateFrom : undefined;
  const dateTo = typeof body.dateTo === "string" && body.dateTo ? body.dateTo : undefined;
  const requestedIds = Array.isArray(body.projectIds)
    ? (body.projectIds.filter((x) => Number.isInteger(x)) as number[])
    : [];
  const s = (body.sections ?? {}) as Record<string, unknown>;
  const sections = {
    obra: !!s.obra,
    bitacora: !!s.bitacora,
    materiales: !!s.materiales,
    asistencia: !!s.asistencia,
  };

  // Obras objetivo, respetando acceso. accessibleIds === null ⇒ acceso total.
  const accessibleIds = await getAccessibleProjectIds(user);
  let allProjects = await db.select().from(projectsTable);
  if (accessibleIds !== null) allProjects = allProjects.filter((p) => accessibleIds.includes(p.id));
  const targetProjects = requestedIds.length > 0
    ? allProjects.filter((p) => requestedIds.includes(p.id))
    : allProjects;
  const projectIds = targetProjects.map((p) => p.id);
  const projectName = new Map(targetProjects.map((p) => [p.id, p.name] as const));

  const [me] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, user.id));
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const dayOf = (d: Date) => d.toISOString().split("T")[0];

  const projects = targetProjects.map((p) => ({
    id: p.id, name: p.name, location: p.location, status: p.status,
    progressPercent: p.progressPercent ?? 0, budget: p.budget ?? null,
    spentAmount: p.spentAmount ?? 0, startDate: p.startDate, endDate: p.endDate,
  }));

  // ─── Obra / avance / presupuesto ─────────────────────────────────────────
  let obra: unknown;
  if (sections.obra) {
    const totalBudget = targetProjects.reduce((acc, p) => acc + (p.budget ?? 0), 0);
    const totalSpent = targetProjects.reduce((acc, p) => acc + (p.spentAmount ?? 0), 0);
    obra = {
      totals: {
        projectCount: targetProjects.length,
        activeCount: targetProjects.filter((p) => p.status === "active").length,
        completedCount: targetProjects.filter((p) => p.status === "completed").length,
        pausedCount: targetProjects.filter((p) => p.status === "paused").length,
        totalBudget, totalSpent, available: totalBudget - totalSpent,
        avgProgress: targetProjects.length
          ? Math.round(targetProjects.reduce((acc, p) => acc + (p.progressPercent ?? 0), 0) / targetProjects.length)
          : 0,
      },
      byProject: targetProjects.map((p) => ({
        projectId: p.id, name: p.name, status: p.status,
        budget: p.budget ?? 0, spent: p.spentAmount ?? 0,
        available: (p.budget ?? 0) - (p.spentAmount ?? 0),
        progressPercent: p.progressPercent ?? 0,
      })),
    };
  }

  // ─── Bitácora ─────────────────────────────────────────────────────────────
  let bitacora: unknown;
  if (sections.bitacora && projectIds.length) {
    const logs = (await db.select().from(workLogsTable).where(inArray(workLogsTable.projectId, projectIds)))
      .filter((l) => {
        if (dateFrom && l.logDate < dateFrom) return false;
        if (dateTo && l.logDate > dateTo) return false;
        return true;
      });
    const byProjectMap = new Map<number, number>();
    const byDateMap = new Map<string, number>();
    for (const l of logs) {
      byProjectMap.set(l.projectId, (byProjectMap.get(l.projectId) ?? 0) + 1);
      byDateMap.set(l.logDate, (byDateMap.get(l.logDate) ?? 0) + 1);
    }
    bitacora = {
      totalLogs: logs.length,
      submittedLogs: logs.filter((l) => l.isSubmitted).length,
      byProject: [...byProjectMap].map(([projectId, count]) => ({ projectId, name: projectName.get(projectId) ?? `#${projectId}`, count })),
      byDate: [...byDateMap].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count })),
      entries: logs
        .sort((a, b) => (a.logDate < b.logDate ? 1 : -1))
        .slice(0, 200)
        .map((l) => ({
          id: l.id, projectId: l.projectId, projectName: projectName.get(l.projectId) ?? null,
          logDate: l.logDate, activity: l.activity, observations: l.observations,
          workersInvolved: l.workersInvolved, isSubmitted: l.isSubmitted,
        })),
    };
  }

  // ─── Materiales y notas de mostrador ───────────────────────────────────────
  let materiales: unknown;
  if (sections.materiales && projectIds.length) {
    const mats = (await db.select().from(materialsTable).where(inArray(materialsTable.projectId, projectIds)))
      .filter((m) => {
        const d = dayOf(m.createdAt);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    const notes = (await db.select().from(materialNotesTable).where(inArray(materialNotesTable.projectId, projectIds)))
      .filter((n) => {
        if (dateFrom && n.noteDate < dateFrom) return false;
        if (dateTo && n.noteDate > dateTo) return false;
        return true;
      });

    const byStatusCount = (st: string) => mats.filter((m) => m.status === st);
    const sum = (arr: typeof mats) => arr.reduce((acc, m) => acc + (m.totalCost ?? 0), 0);
    const approved = byStatusCount("approved");
    const pending = byStatusCount("pending");
    const rejected = byStatusCount("rejected");

    const supplierMap = new Map<string, { spend: number; count: number }>();
    for (const n of notes) {
      const key = n.supplierName?.trim() || "Sin proveedor";
      const cur = supplierMap.get(key) ?? { spend: 0, count: 0 };
      cur.spend += n.totalAmount ?? 0; cur.count += 1;
      supplierMap.set(key, cur);
    }
    const byProjectMap = new Map<number, { approvedSpend: number; pendingSpend: number; count: number }>();
    for (const m of mats) {
      const cur = byProjectMap.get(m.projectId) ?? { approvedSpend: 0, pendingSpend: 0, count: 0 };
      if (m.status === "approved") cur.approvedSpend += m.totalCost ?? 0;
      if (m.status === "pending") cur.pendingSpend += m.totalCost ?? 0;
      cur.count += 1;
      byProjectMap.set(m.projectId, cur);
    }

    materiales = {
      totalItems: mats.length,
      totalNotes: notes.length,
      // "gastado" solo cuenta aprobados — consistente con GET /reports/:id/data
      spend: { approved: sum(approved), pending: sum(pending), rejected: sum(rejected), total: sum(approved) },
      byStatus: [
        { status: "approved", label: "Aprobado", count: approved.length, spend: sum(approved) },
        { status: "pending", label: "Pendiente", count: pending.length, spend: sum(pending) },
        { status: "rejected", label: "Rechazado", count: rejected.length, spend: sum(rejected) },
      ],
      bySupplier: [...supplierMap]
        .map(([supplier, v]) => ({ supplier, spend: v.spend, count: v.count }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 15),
      byProject: [...byProjectMap].map(([projectId, v]) => ({
        projectId, name: projectName.get(projectId) ?? `#${projectId}`,
        approvedSpend: v.approvedSpend, pendingSpend: v.pendingSpend, count: v.count,
      })),
      items: mats
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 200)
        .map((m) => ({
          id: m.id, projectId: m.projectId, projectName: projectName.get(m.projectId) ?? null,
          name: m.name, unit: m.unit, quantity: m.quantityApproved ?? m.quantityRequested,
          status: m.status, totalCost: m.totalCost,
        })),
    };
  }

  // ─── Asistencia / Geocheck ─────────────────────────────────────────────────
  let asistencia: unknown;
  if (sections.asistencia && projectIds.length) {
    const checks = (await db.select().from(checkInsTable).where(inArray(checkInsTable.projectId, projectIds)))
      .filter((c) => {
        const d = dayOf(c.checkInAt);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    const userIds = [...new Set(checks.map((c) => c.userId))];
    const usersRows = userIds.length
      ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
      : [];
    const userName = new Map(usersRows.map((u) => [u.id, u.name] as const));
    const isFlagged = (c: typeof checks[number]) => c.checkInStatus === "flagged" || c.checkOutStatus === "flagged";

    const byWorkerMap = new Map<number, { checkIns: number; minutes: number; flagged: number }>();
    const byProjectMap = new Map<number, { checkIns: number; minutes: number }>();
    const byDateMap = new Map<string, number>();
    for (const c of checks) {
      const w = byWorkerMap.get(c.userId) ?? { checkIns: 0, minutes: 0, flagged: 0 };
      w.checkIns += 1; w.minutes += c.totalMinutes ?? 0; if (isFlagged(c)) w.flagged += 1;
      byWorkerMap.set(c.userId, w);
      const pr = byProjectMap.get(c.projectId) ?? { checkIns: 0, minutes: 0 };
      pr.checkIns += 1; pr.minutes += c.totalMinutes ?? 0;
      byProjectMap.set(c.projectId, pr);
      const d = dayOf(c.checkInAt);
      byDateMap.set(d, (byDateMap.get(d) ?? 0) + 1);
    }
    const totalMinutes = checks.reduce((acc, c) => acc + (c.totalMinutes ?? 0), 0);

    asistencia = {
      totalCheckIns: checks.length,
      openSessions: checks.filter((c) => !c.checkOutAt).length,
      flaggedCount: checks.filter(isFlagged).length,
      totalHours: round1(totalMinutes / 60),
      byWorker: [...byWorkerMap]
        .map(([userId, v]) => ({ userId, name: userName.get(userId) ?? `#${userId}`, checkIns: v.checkIns, hours: round1(v.minutes / 60), flagged: v.flagged }))
        .sort((a, b) => b.hours - a.hours),
      byProject: [...byProjectMap].map(([projectId, v]) => ({ projectId, name: projectName.get(projectId) ?? `#${projectId}`, checkIns: v.checkIns, hours: round1(v.minutes / 60) })),
      byDate: [...byDateMap].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, checkIns]) => ({ date, checkIns })),
      entries: checks
        .sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime())
        .slice(0, 200)
        .map((c) => ({
          id: c.id, projectId: c.projectId, projectName: projectName.get(c.projectId) ?? null,
          userId: c.userId, userName: userName.get(c.userId) ?? null,
          checkInAt: c.checkInAt, checkOutAt: c.checkOutAt, totalMinutes: c.totalMinutes,
          status: c.checkInStatus, distanceMeters: c.checkInDistanceMeters,
        })),
    };
  }

  res.json({
    meta: {
      generatedAt: new Date().toISOString(),
      generatedByName: me?.name ?? null,
      projectCount: targetProjects.length,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      sections,
    },
    projects,
    obra,
    bitacora,
    materiales,
    asistencia,
  });
});

export default router;
