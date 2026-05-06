import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, documentsTable, projectsTable, usersTable } from "@workspace/db";
import { getRequestUser } from "../lib/getRequestUser";
import { resolveAuthedUser } from "../lib/authContext";
import { hasPermission } from "../lib/permissions";
import { getAccessibleProjectIds, canAccessProject } from "../lib/projectAccess";
import { formatZodError } from "../lib/zodError";
import {
  CreateDocumentBody,
  GetDocumentParams,
  DeleteDocumentParams,
  ListDocumentsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function enrichDocument(doc: typeof documentsTable.$inferSelect) {
  const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, doc.projectId));
  const [uploader] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, doc.uploadedById));
  return {
    ...doc,
    projectName: project?.name ?? null,
    uploadedByName: uploader?.name ?? null,
  };
}

router.get("/documents", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!await hasPermission(user.role, "documentsLegalView")) {
    res.status(403).json({ error: "No tienes permiso para ver documentos" }); return;
  }

  const parsed = ListDocumentsQueryParams.safeParse(req.query);
  let docs = await db.select().from(documentsTable).orderBy(documentsTable.createdAt);

  const accessibleIds = await getAccessibleProjectIds(user);
  if (accessibleIds !== null) {
    if (accessibleIds.length === 0) { res.json([]); return; }
    docs = docs.filter((d) => accessibleIds.includes(d.projectId));
  }

  if (parsed.success) {
    if (parsed.data.projectId) docs = docs.filter((d) => d.projectId === parsed.data.projectId);
    if (parsed.data.category) docs = docs.filter((d) => d.category === parsed.data.category);
  }

  res.json(await Promise.all(docs.map(enrichDocument)));
});

router.post("/documents", async (req, res): Promise<void> => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const actor = await resolveAuthedUser(req);
  if (!actor) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!await hasPermission(actor.role, "documentsLegalManage")) {
    res.status(403).json({ error: "No tienes permiso para subir documentos" });
    return;
  }
  const [doc] = await db.insert(documentsTable).values({ ...parsed.data, uploadedById: actor.id }).returning();
  res.status(201).json(await enrichDocument(doc));
});

router.get("/documents/:id", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!await hasPermission(user.role, "documentsLegalView")) {
    res.status(403).json({ error: "No tienes permiso para ver documentos" });
    return;
  }

  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, params.data.id));
  if (!doc) {
    res.status(404).json({ error: "Documento no encontrado" });
    return;
  }
  // Documents may be associated with a specific project (via projectId) or
  // be global to the org. Project-scoped documents must respect access.
  if (doc.projectId != null && !(await canAccessProject(user, doc.projectId))) {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }

  res.json(await enrichDocument(doc));
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const actor = await resolveAuthedUser(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }

  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: formatZodError(params.error) });
    return;
  }

  // Solo admin o supervisor pueden eliminar documentos.
  // No se permite borrado por dueño no-privilegiado para evitar que un cliente,
  // trabajador o proveedor borre evidencia/contratos que él mismo subió.
  if (!await hasPermission(actor.role, "documentsLegalManage")) {
    res.status(403).json({ error: "No tienes permiso para eliminar documentos" });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, params.data.id));
  if (!doc) { res.status(404).json({ error: "Documento no encontrado" }); return; }

  await db.delete(documentsTable).where(eq(documentsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
