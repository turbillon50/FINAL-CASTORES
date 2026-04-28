import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, workLogsTable, projectsTable, usersTable } from "@workspace/db";
import { getRequestUser } from "../lib/getRequestUser";
import { resolveAuthedUser } from "../lib/authContext";
import { getAccessibleProjectIds, canAccessProject } from "../lib/projectAccess";
import { formatZodError } from "../lib/zodError";
import {
  CreateLogBody,
  UpdateLogBody,
  GetLogParams,
  UpdateLogParams,
  SubmitLogParams,
  SignLogParams,
  SignLogBody,
  ListLogsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function enrichLog(log: typeof workLogsTable.$inferSelect) {
  const [project] = log.projectId
    ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, log.projectId))
    : [null];
  const [supervisor] = log.supervisorId
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, log.supervisorId))
    : [null];

  return {
    ...log,
    photos: log.photos ?? [],
    projectName: project?.name ?? null,
    supervisorName: supervisor?.name ?? null,
  };
}

router.get("/logs", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const parsed = ListLogsQueryParams.safeParse(req.query);
  let logs = await db.select().from(workLogsTable).orderBy(workLogsTable.logDate);

  const accessibleIds = await getAccessibleProjectIds(user);
  if (accessibleIds !== null) {
    if (accessibleIds.length === 0) { res.json([]); return; }
    logs = logs.filter((l) => l.projectId !== null && accessibleIds.includes(l.projectId));
  }

  if (parsed.success) {
    if (parsed.data.projectId) logs = logs.filter((l) => l.projectId === parsed.data.projectId);
    if (parsed.data.supervisorId) logs = logs.filter((l) => l.supervisorId === parsed.data.supervisorId);
    if (parsed.data.date) logs = logs.filter((l) => l.logDate === parsed.data.date);
  }

  res.json(await Promise.all(logs.map(enrichLog)));
});

router.post("/logs", async (req, res): Promise<void> => {
  const parsed = CreateLogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const actor = await resolveAuthedUser(req);
  if (!actor) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const [log] = await db
    .insert(workLogsTable)
    .values({ ...parsed.data, supervisorId: actor.id, photos: parsed.data.photos ?? [] })
    .returning();

  res.status(201).json(await enrichLog(log));
});

router.get("/logs/:id", async (req, res): Promise<void> => {
  const params = GetLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const [log] = await db.select().from(workLogsTable).where(eq(workLogsTable.id, params.data.id));
  if (!log) {
    res.status(404).json({ error: "Bitácora no encontrada" });
    return;
  }

  res.json(await enrichLog(log));
});

router.patch("/logs/:id", async (req, res): Promise<void> => {
  const params = UpdateLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const [existing] = await db.select().from(workLogsTable).where(eq(workLogsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Bitácora no encontrada" });
    return;
  }
  if (existing.isSubmitted) {
    res.status(403).json({ error: "No se puede editar una bitácora ya enviada" });
    return;
  }

  const parsed = UpdateLogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== null && v !== undefined) data[k] = v;
  }

  const [log] = await db.update(workLogsTable).set(data).where(eq(workLogsTable.id, params.data.id)).returning();
  res.json(await enrichLog(log));
});

router.post("/logs/:id/submit", async (req, res): Promise<void> => {
  const params = SubmitLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const [log] = await db
    .update(workLogsTable)
    .set({ isSubmitted: true, submittedAt: new Date() })
    .where(eq(workLogsTable.id, params.data.id))
    .returning();

  if (!log) {
    res.status(404).json({ error: "Bitácora no encontrada" });
    return;
  }

  res.json(await enrichLog(log));
});

router.post("/logs/:id/sign", async (req, res): Promise<void> => {
  const actor = await resolveAuthedUser(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }

  const params = SignLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const parsed = SignLogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  // Validar que el rol del usuario corresponde al tipo de firma:
  //  - signatureType="supervisor" → solo admin o supervisor
  //  - signatureType="client"     → solo admin o cliente
  const sigType = parsed.data.signatureType;
  const allowed =
    sigType === "supervisor"
      ? actor.role === "supervisor" || actor.role === "admin"
      : actor.role === "client" || actor.role === "admin";
  if (!allowed) {
    res.status(403).json({
      error:
        sigType === "supervisor"
          ? "Solo supervisores pueden firmar como supervisor"
          : "Solo clientes pueden firmar como cliente",
    });
    return;
  }

  // Acceso al proyecto: el firmante debe poder acceder a la obra de la bitácora.
  const [existing] = await db.select().from(workLogsTable).where(eq(workLogsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Bitácora no encontrada" }); return; }
  if (existing.projectId && !(await canAccessProject(actor, existing.projectId))) {
    res.status(403).json({ error: "No tienes acceso a esta obra" });
    return;
  }

  const field = sigType === "supervisor" ? "supervisorSignature" : "clientSignature";
  const [log] = await db
    .update(workLogsTable)
    .set({ [field]: parsed.data.signatureData })
    .where(eq(workLogsTable.id, params.data.id))
    .returning();

  if (!log) {
    res.status(404).json({ error: "Bitácora no encontrada" });
    return;
  }

  res.json(await enrichLog(log));
});

export default router;
