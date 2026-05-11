import { Router, type IRouter } from "express";
import { and, eq, desc, inArray } from "drizzle-orm";
import {
  db,
  materialNotesTable,
  materialsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { resolveAuthedUser } from "../lib/authContext";
import { hasPermission } from "../lib/permissions";
import { canAccessProject, getAccessibleProjectIds } from "../lib/projectAccess";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type IncomingItem = {
  name?: string;
  description?: string | null;
  unit?: string;
  quantityRequested?: number;
  costPerUnit?: number | null;
  notes?: string | null;
};

type IncomingNoteBody = {
  projectId?: number;
  noteDate?: string;
  folio?: string | null;
  supplierName?: string | null;
  description?: string | null;
  status?: string;
  items?: IncomingItem[];
};

function validateItem(it: IncomingItem | undefined, idx: number): string | null {
  if (!it) return `Renglón ${idx + 1}: inválido`;
  if (!it.name || it.name.trim().length === 0) return `Renglón ${idx + 1}: nombre requerido`;
  if (!it.unit || it.unit.trim().length === 0) return `Renglón ${idx + 1}: unidad requerida`;
  if (typeof it.quantityRequested !== "number" || !Number.isFinite(it.quantityRequested) || it.quantityRequested <= 0) {
    return `Renglón ${idx + 1}: cantidad debe ser mayor a 0`;
  }
  if (it.costPerUnit != null && (!Number.isFinite(it.costPerUnit) || it.costPerUnit < 0)) {
    return `Renglón ${idx + 1}: costo unitario inválido`;
  }
  return null;
}

function sumTotal(items: IncomingItem[]): number {
  return items.reduce((acc, it) => {
    const qty = Number(it.quantityRequested) || 0;
    const cost = it.costPerUnit == null ? 0 : Number(it.costPerUnit);
    return acc + qty * cost;
  }, 0);
}

/**
 * GET /api/material-notes — lista de notas con cabecera + número de
 * renglones + nombre del proyecto y del creador. Filtros opcionales:
 *   ?projectId=NN     — solo notas de esa obra
 *   ?createdById=NN   — solo notas creadas por ese usuario
 *   ?supplier=texto   — match por subcadena en supplier_name (case-insensitive)
 *   ?from=YYYY-MM-DD  — note_date >= from
 *   ?to=YYYY-MM-DD    — note_date <= to
 *
 * Aplica filtro de acceso a proyectos: los usuarios no-admin solo ven
 * notas de obras a las que tienen acceso explícito.
 */
router.get("/material-notes", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const accessibleIds = await getAccessibleProjectIds(user);

  let rows = await db
    .select()
    .from(materialNotesTable)
    .orderBy(desc(materialNotesTable.createdAt));

  if (accessibleIds !== null) {
    if (accessibleIds.length === 0) { res.json([]); return; }
    rows = rows.filter((r) => accessibleIds.includes(r.projectId));
  }

  // Filtros opcionales — aplicamos en memoria porque ya cargamos en bloque
  // y la cantidad esperada de notas no justifica WHERE dinámicos complejos.
  const qProjectId = req.query["projectId"] ? Number(req.query["projectId"]) : null;
  const qCreatedById = req.query["createdById"] ? Number(req.query["createdById"]) : null;
  const qSupplier = typeof req.query["supplier"] === "string" ? String(req.query["supplier"]).toLowerCase() : null;
  const qFrom = typeof req.query["from"] === "string" ? String(req.query["from"]) : null;
  const qTo = typeof req.query["to"] === "string" ? String(req.query["to"]) : null;

  if (qProjectId && Number.isFinite(qProjectId)) rows = rows.filter((r) => r.projectId === qProjectId);
  if (qCreatedById && Number.isFinite(qCreatedById)) rows = rows.filter((r) => r.createdById === qCreatedById);
  if (qSupplier) rows = rows.filter((r) => (r.supplierName ?? "").toLowerCase().includes(qSupplier));
  if (qFrom) rows = rows.filter((r) => r.noteDate >= qFrom);
  if (qTo) rows = rows.filter((r) => r.noteDate <= qTo);

  if (rows.length === 0) { res.json([]); return; }

  // Enrich: nombre del proyecto, nombre del creador, conteo de renglones.
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const userIds = [...new Set(rows.map((r) => r.createdById))];
  const [projects, users, itemCounts] = await Promise.all([
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(inArray(projectsTable.id, projectIds)),
    db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds)),
    db.select({ noteId: materialsTable.noteId, id: materialsTable.id }).from(materialsTable).where(inArray(materialsTable.noteId, rows.map((r) => r.id))),
  ]);
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const countMap = new Map<number, number>();
  for (const it of itemCounts) {
    if (it.noteId == null) continue;
    countMap.set(it.noteId, (countMap.get(it.noteId) ?? 0) + 1);
  }

  res.json(rows.map((r) => ({
    ...r,
    projectName: projectMap.get(r.projectId) ?? null,
    createdByName: userMap.get(r.createdById) ?? null,
    itemCount: countMap.get(r.id) ?? 0,
  })));
});

/**
 * GET /api/material-notes/:id — devuelve la cabecera + todos los renglones
 * asociados (los materiales con note_id = :id).
 */
router.get("/material-notes/:id", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

  const [note] = await db.select().from(materialNotesTable).where(eq(materialNotesTable.id, id));
  if (!note) { res.status(404).json({ error: "Nota no encontrada" }); return; }

  if (!(await canAccessProject(user, note.projectId))) {
    res.status(403).json({ error: "Sin acceso a esta obra" }); return;
  }

  const items = await db.select().from(materialsTable).where(eq(materialsTable.noteId, id)).orderBy(materialsTable.id);

  res.json({ ...note, items });
});

/**
 * POST /api/material-notes — crea una nota con N renglones en transacción.
 * Si cualquier renglón es inválido (o el insert falla) hace rollback y la
 * nota no queda en la DB. El total se calcula del lado servidor a partir
 * de los renglones, para no confiar en lo que mande el cliente.
 */
router.post("/material-notes", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(user.role, "materialsRequest"))) {
    res.status(403).json({ error: "No tienes permiso para solicitar materiales" }); return;
  }

  const body = req.body as IncomingNoteBody;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Body inválido" }); return;
  }
  if (!body.projectId || !Number.isFinite(body.projectId)) {
    res.status(400).json({ error: "projectId requerido" }); return;
  }
  if (!body.noteDate || typeof body.noteDate !== "string") {
    res.status(400).json({ error: "Fecha requerida" }); return;
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    res.status(400).json({ error: "Agrega al menos un concepto" }); return;
  }
  for (let i = 0; i < body.items.length; i++) {
    const err = validateItem(body.items[i], i);
    if (err) { res.status(400).json({ error: err }); return; }
  }
  if (!(await canAccessProject(user, body.projectId))) {
    res.status(403).json({ error: "Sin acceso a esta obra" }); return;
  }

  const total = sumTotal(body.items);

  try {
    const result = await db.transaction(async (tx) => {
      const [note] = await tx
        .insert(materialNotesTable)
        .values({
          projectId: body.projectId as number,
          createdById: user.id,
          noteDate: body.noteDate as string,
          folio: body.folio ?? null,
          supplierName: body.supplierName ?? null,
          description: body.description ?? null,
          totalAmount: total,
          status: body.status === "approved" ? "approved" : "draft",
        })
        .returning();

      const itemRows = (body.items as IncomingItem[]).map((it) => ({
        projectId: body.projectId as number,
        requestedById: user.id,
        noteId: note.id,
        name: (it.name as string).trim(),
        description: it.description ?? null,
        unit: (it.unit as string).trim(),
        quantityRequested: it.quantityRequested as number,
        costPerUnit: it.costPerUnit ?? null,
        totalCost: it.costPerUnit != null ? (it.costPerUnit as number) * (it.quantityRequested as number) : null,
        notes: it.notes ?? null,
        status: "pending" as const,
      }));

      const inserted = await tx.insert(materialsTable).values(itemRows).returning();
      return { note, items: inserted };
    });

    res.status(201).json(result);
  } catch (err) {
    logger.error({ err }, "POST /material-notes failed");
    res.status(500).json({ error: "No se pudo guardar la nota" });
  }
});

/**
 * DELETE /api/material-notes/:id — borra cabecera + todos sus renglones.
 * Solo el creador o un usuario con materialsApprove pueden borrarla.
 */
router.delete("/material-notes/:id", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

  const [note] = await db.select().from(materialNotesTable).where(eq(materialNotesTable.id, id));
  if (!note) { res.status(404).json({ error: "Nota no encontrada" }); return; }

  const canApprove = await hasPermission(user.role, "materialsApprove");
  if (note.createdById !== user.id && !canApprove) {
    res.status(403).json({ error: "Solo el creador o un aprobador puede eliminar esta nota" });
    return;
  }
  if (!(await canAccessProject(user, note.projectId))) {
    res.status(403).json({ error: "Sin acceso a esta obra" }); return;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.delete(materialsTable).where(eq(materialsTable.noteId, id));
      await tx.delete(materialNotesTable).where(eq(materialNotesTable.id, id));
    });
    res.sendStatus(204);
  } catch (err) {
    logger.error({ err, noteId: id }, "DELETE /material-notes/:id failed");
    res.status(500).json({ error: "No se pudo eliminar la nota" });
  }
});

/**
 * POST /api/material-notes/scan — MOCK pendiente.
 *
 * En cuanto el dueño nos pase ANTHROPIC_API_KEY, este endpoint hará lo
 * siguiente: recibirá una foto (base64) → llamará a Claude Vision con un
 * prompt + schema → devolverá un objeto IncomingNoteBody con items
 * preparados para revisión humana antes de confirmar.
 *
 * Por ahora regresa 501 con una explicación clara para que el frontend
 * sepa que el botón está visible pero deshabilitado/etiquetado como
 * "próximamente".
 */
router.post("/material-notes/scan", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  void req;
  res.status(501).json({
    ok: false,
    pending: true,
    message: "El escaneo automático de notas está en desarrollo. Por ahora captura los conceptos manualmente — pronto la foto rellenará todo solo.",
  });
});

export default router;
