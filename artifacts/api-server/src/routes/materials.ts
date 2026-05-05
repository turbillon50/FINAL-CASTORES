import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, materialsTable, projectsTable, usersTable } from "@workspace/db";
import { getRequestUser } from "../lib/getRequestUser";
import { resolveAuthedUser } from "../lib/authContext";
import { hasPermission } from "../lib/permissions";
import { getAccessibleProjectIds, canAccessProject } from "../lib/projectAccess";
import { formatZodError } from "../lib/zodError";
import {
  CreateMaterialBody,
  UpdateMaterialBody,
  GetMaterialParams,
  UpdateMaterialParams,
  DeleteMaterialParams,
  ApproveMaterialParams,
  ListMaterialsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function enrichMaterial(m: typeof materialsTable.$inferSelect) {
  const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, m.projectId));
  const [requestedBy] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, m.requestedById));
  const [approvedBy] = m.approvedById
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, m.approvedById))
    : [null];

  return {
    ...m,
    projectName: project?.name ?? null,
    requestedByName: requestedBy?.name ?? null,
    approvedByName: approvedBy?.name ?? null,
  };
}

router.get("/materials", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const parsed = ListMaterialsQueryParams.safeParse(req.query);
  let materials = await db.select().from(materialsTable).orderBy(materialsTable.createdAt);

  const accessibleIds = await getAccessibleProjectIds(user);
  if (accessibleIds !== null) {
    if (accessibleIds.length === 0) { res.json([]); return; }
    materials = materials.filter((m) => accessibleIds.includes(m.projectId));
  }

  if (parsed.success) {
    if (parsed.data.projectId) materials = materials.filter((m) => m.projectId === parsed.data.projectId);
    if (parsed.data.status) materials = materials.filter((m) => m.status === parsed.data.status);
  }

  res.json(await Promise.all(materials.map(enrichMaterial)));
});

router.post("/materials", async (req, res): Promise<void> => {
  const parsed = CreateMaterialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const actor = await resolveAuthedUser(req);
  if (!actor) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!await hasPermission(actor.role, "materialsRequest")) {
    res.status(403).json({ error: "No tienes permiso para solicitar materiales" });
    return;
  }
  const userId = actor.id;
  const totalCost = parsed.data.costPerUnit
    ? parsed.data.costPerUnit * parsed.data.quantityRequested
    : null;

  const [material] = await db
    .insert(materialsTable)
    .values({ ...parsed.data, requestedById: userId, totalCost })
    .returning();

  res.status(201).json(await enrichMaterial(material));
});

router.get("/materials/alerts", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  // Filter alerts to projects the requester can actually see. Without this,
  // any authenticated role (worker, proveedor, etc.) saw the full alerts feed
  // for every project in the system.
  const accessibleIds = await getAccessibleProjectIds(user);
  let materials = await db.select().from(materialsTable);
  if (accessibleIds !== null) {
    if (accessibleIds.length === 0) { res.json([]); return; }
    materials = materials.filter((m) => accessibleIds.includes(m.projectId));
  }

  const projects = await db.select().from(projectsTable);
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  const alerts = [];

  for (const m of materials) {
    if (m.status === "pending") {
      alerts.push({
        materialId: m.id,
        projectId: m.projectId,
        projectName: projectMap.get(m.projectId) ?? "Desconocido",
        materialName: m.name,
        alertType: "pending_approval",
        message: `Solicitud pendiente de aprobación: ${m.name} (${m.quantityRequested} ${m.unit})`,
        severity: "medium",
        createdAt: m.createdAt,
      });
    }

    if (m.quantityUsed && m.quantityApproved && m.quantityUsed > m.quantityApproved * 1.2) {
      alerts.push({
        materialId: m.id,
        projectId: m.projectId,
        projectName: projectMap.get(m.projectId) ?? "Desconocido",
        materialName: m.name,
        alertType: "unusual_consumption",
        message: `Consumo inusual detectado en ${m.name}: usado ${m.quantityUsed} de ${m.quantityApproved} aprobados`,
        severity: "high",
        createdAt: m.updatedAt,
      });
    }
  }

  res.json(alerts);
});

router.get("/materials/:id", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const params = GetMaterialParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const [material] = await db.select().from(materialsTable).where(eq(materialsTable.id, params.data.id));
  if (!material) {
    res.status(404).json({ error: "Material no encontrado" });
    return;
  }

  // Project-scoped read: the user must have access to the material's project.
  // Without this any authenticated user could read material details from any
  // project just by knowing/guessing the id.
  const allowed = await canAccessProject(user, material.projectId);
  if (!allowed) { res.status(403).json({ error: "Acceso denegado" }); return; }

  res.json(await enrichMaterial(material));
});

router.patch("/materials/:id", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const params = UpdateMaterialParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const parsed = UpdateMaterialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  // Necesitamos el material actual para recalcular totalCost si cambia
  // costPerUnit, quantityRequested o quantityApproved.
  const [existing] = await db
    .select()
    .from(materialsTable)
    .where(eq(materialsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Material no encontrado" });
    return;
  }

  // Project-scoped write: must have access to the material's project AND
  // permission to change material data. Workers can register usage only
  // (materialsRequest), suppliers can supply (materialsSupply), supervisors
  // and admins can approve/edit (materialsApprove).
  const allowed = await canAccessProject(user, existing.projectId);
  if (!allowed) { res.status(403).json({ error: "Acceso denegado" }); return; }
  const canApprove = await hasPermission(user.role, "materialsApprove");
  const canSupply = await hasPermission(user.role, "materialsSupply");
  const canRequest = await hasPermission(user.role, "materialsRequest");
  if (!canApprove && !canSupply && !canRequest) {
    res.status(403).json({ error: "No tienes permiso para modificar materiales" });
    return;
  }

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== null && v !== undefined) data[k] = v;
  }

  // Recalcular totalCost cuando se actualicen cualquiera de los inputs.
  const touchesCost =
    "costPerUnit" in data ||
    "quantityRequested" in data ||
    "quantityApproved" in data;
  if (touchesCost) {
    const costPerUnit =
      (data.costPerUnit as number | undefined) ?? existing.costPerUnit ?? null;
    const qty =
      (data.quantityApproved as number | undefined) ??
      existing.quantityApproved ??
      (data.quantityRequested as number | undefined) ??
      existing.quantityRequested;
    data.totalCost = costPerUnit != null ? costPerUnit * qty : null;
  }

  const [material] = await db
    .update(materialsTable)
    .set(data)
    .where(eq(materialsTable.id, params.data.id))
    .returning();

  if (!material) {
    res.status(404).json({ error: "Material no encontrado" });
    return;
  }

  res.json(await enrichMaterial(material));
});

router.delete("/materials/:id", async (req, res): Promise<void> => {
  const actor = await resolveAuthedUser(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!await hasPermission(actor.role, "materialsApprove")) {
    res.status(403).json({ error: "No tienes permiso para eliminar materiales" });
    return;
  }

  const params = DeleteMaterialParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  await db.delete(materialsTable).where(eq(materialsTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/materials/:id/approve", async (req, res): Promise<void> => {
  const actor = await resolveAuthedUser(req);
  if (!actor) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!await hasPermission(actor.role, "materialsApprove")) {
    res.status(403).json({ error: "No tienes permiso para aprobar materiales" });
    return;
  }

  const params = ApproveMaterialParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const [material] = await db
    .update(materialsTable)
    .set({ status: "approved", approvedById: actor.id, approvedAt: new Date() })
    .where(eq(materialsTable.id, params.data.id))
    .returning();

  if (!material) {
    res.status(404).json({ error: "Material no encontrado" });
    return;
  }

  res.json(await enrichMaterial(material));
});

export default router;
