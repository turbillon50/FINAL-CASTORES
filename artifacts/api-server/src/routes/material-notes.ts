import { Router, type IRouter } from "express";
import { and, eq, desc, inArray } from "drizzle-orm";
import {
  db,
  pool,
  materialNotesTable,
  materialsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { resolveAuthedUser } from "../lib/authContext";
import { hasPermission } from "../lib/permissions";
import { canAccessProject, getAccessibleProjectIds } from "../lib/projectAccess";
import { logger } from "../lib/logger";
import { randomUUID } from "node:crypto";
import { parseScanJson, scanWithGemini, scanErrorMessage } from "../lib/invoiceScan";

const router: IRouter = Router();

// ── Fotos de facturas ──────────────────────────────────────────────
// Límite propio bajo el tope de 4.5 MB de Vercel por request.
const MAX_RECEIPT_CHARS = 4 * 1024 * 1024;

function validReceiptImage(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("data:image/") && v.length <= MAX_RECEIPT_CHARS;
}

async function saveReceipt(noteId: number, image: string, userId: number): Promise<void> {
  await pool.query(
    `INSERT INTO material_note_receipts (note_id, image, uploaded_by_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (note_id) DO UPDATE SET image = EXCLUDED.image,
       uploaded_by_id = EXCLUDED.uploaded_by_id, updated_at = NOW()`,
    [noteId, image, userId],
  );
}

async function receiptNoteIds(noteIds: number[]): Promise<Set<number>> {
  if (noteIds.length === 0) return new Set();
  try {
    const r = await pool.query<{ note_id: number }>(
      `SELECT note_id FROM material_note_receipts WHERE note_id = ANY($1::int[])`,
      [noteIds],
    );
    return new Set(r.rows.map((x) => Number(x.note_id)));
  } catch (err) {
    // Si la tabla aún no existe (migración en curso), la lista no se cae.
    logger.warn({ err }, "receiptNoteIds failed");
    return new Set();
  }
}

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
  receiptImage?: string | null;
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

  // Las notas de mostrador son facturas escaneadas CON precios de proveedor.
  // El cliente obtiene material + cantidad desde el reporte, no de aquí, así
  // que bloquear el acceso es seguro y evita la fuga de costos de compra.
  if (user.role === "client") { res.status(403).json({ error: "No disponible para tu rol" }); return; }

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
  const withReceipt = await receiptNoteIds(rows.map((r) => r.id));
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
    hasReceipt: withReceipt.has(r.id),
  })));
});

/**
 * GET /api/material-notes/:id — devuelve la cabecera + todos los renglones
 * asociados (los materiales con note_id = :id).
 */
router.get("/material-notes/:id", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  // Ver comentario en GET /material-notes: el cliente no ve facturas de proveedor.
  if (user.role === "client") { res.status(403).json({ error: "No disponible para tu rol" }); return; }

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

  const [note] = await db.select().from(materialNotesTable).where(eq(materialNotesTable.id, id));
  if (!note) { res.status(404).json({ error: "Nota no encontrada" }); return; }

  if (!(await canAccessProject(user, note.projectId))) {
    res.status(403).json({ error: "Sin acceso a esta obra" }); return;
  }

  const items = await db.select().from(materialsTable).where(eq(materialsTable.noteId, id)).orderBy(materialsTable.id);

  const withReceipt = await receiptNoteIds([id]);
  res.json({ ...note, items, hasReceipt: withReceipt.has(id) });
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

  if (body.receiptImage != null && !validReceiptImage(body.receiptImage)) {
    res.status(400).json({ error: "La foto de la factura no es válida o pesa más de 4 MB" }); return;
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
        // Notas de mostrador = registro de gasto YA HECHO (factura/recibo
        // capturado por el dueño). No requieren aprobación separada como
        // sí pasa con las solicitudes individuales del Kanban. Si se
        // dejaran en "pending", FINANZAS mostraría $0 aunque el dinero
        // ya salió, que fue justo el reclamo del cliente.
        status: "approved" as const,
        approvedById: user.id,
        approvedAt: new Date(),
      }));

      const inserted = await tx.insert(materialsTable).values(itemRows).returning();
      return { note, items: inserted };
    });

    let receiptSaved = false;
    if (body.receiptImage) {
      try {
        await saveReceipt(result.note.id, body.receiptImage, user.id);
        receiptSaved = true;
      } catch (err) {
        // La nota ya quedó; la foto se puede adjuntar después desde la nota.
        logger.error({ err, noteId: result.note.id }, "POST /material-notes: receipt save failed");
      }
    }
    res.status(201).json({ ...result, receiptSaved });
  } catch (err) {
    logger.error({ err }, "POST /material-notes failed");
    res.status(500).json({ error: "No se pudo guardar la nota" });
  }
});

/**
 * GET /api/material-notes/:id/receipt — la foto de la factura (data URL).
 * Mismas reglas de acceso que el detalle: el cliente no la ve.
 */
router.get("/material-notes/:id/receipt", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (user.role === "client") { res.status(403).json({ error: "No disponible para tu rol" }); return; }

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

  const [note] = await db.select().from(materialNotesTable).where(eq(materialNotesTable.id, id));
  if (!note) { res.status(404).json({ error: "Nota no encontrada" }); return; }
  if (!(await canAccessProject(user, note.projectId))) {
    res.status(403).json({ error: "Sin acceso a esta obra" }); return;
  }

  const r = await pool.query<{ image: string; updated_at: string }>(
    `SELECT image, updated_at FROM material_note_receipts WHERE note_id = $1`, [id],
  );
  if (r.rows.length === 0) { res.status(404).json({ error: "Esta nota no tiene foto" }); return; }
  res.setHeader("Cache-Control", "private, max-age=300");
  res.json({ image: r.rows[0].image, updatedAt: r.rows[0].updated_at });
});

/**
 * PUT /api/material-notes/:id/receipt — adjunta o reemplaza la foto.
 * Solo el creador de la nota o quien puede aprobar materiales.
 */
router.put("/material-notes/:id/receipt", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

  const [note] = await db.select().from(materialNotesTable).where(eq(materialNotesTable.id, id));
  if (!note) { res.status(404).json({ error: "Nota no encontrada" }); return; }

  const canApprove = await hasPermission(user.role, "materialsApprove");
  if (note.createdById !== user.id && !canApprove) {
    res.status(403).json({ error: "Solo el creador o un aprobador puede cambiar la foto" }); return;
  }
  if (!(await canAccessProject(user, note.projectId))) {
    res.status(403).json({ error: "Sin acceso a esta obra" }); return;
  }

  const { image } = req.body as { image?: unknown };
  if (!validReceiptImage(image)) {
    res.status(400).json({ error: "Adjunta una foto válida (máx. 4 MB)" }); return;
  }

  try {
    await saveReceipt(id, image, user.id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, noteId: id }, "PUT receipt failed");
    res.status(500).json({ error: "No se pudo guardar la foto" });
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
    await pool.query(`DELETE FROM material_note_receipts WHERE note_id = $1`, [id])
      .catch((err: unknown) => logger.warn({ err, noteId: id }, "receipt cleanup failed"));
    res.sendStatus(204);
  } catch (err) {
    logger.error({ err, noteId: id }, "DELETE /material-notes/:id failed");
    res.status(500).json({ error: "No se pudo eliminar la nota" });
  }
});

/**
 * PATCH /api/material-notes/:id — edita cabecera + renglones de una nota.
 * Solo el creador o un usuario con materialsApprove pueden editarla.
 * Los renglones se reemplazan en su totalidad en una transacción.
 */
router.patch("/material-notes/:id", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "ID inválido" }); return; }

  const [note] = await db.select().from(materialNotesTable).where(eq(materialNotesTable.id, id));
  if (!note) { res.status(404).json({ error: "Nota no encontrada" }); return; }

  const canApprove = await hasPermission(user.role, "materialsApprove");
  if (note.createdById !== user.id && !canApprove) {
    res.status(403).json({ error: "Solo el creador o un aprobador puede editar esta nota" });
    return;
  }
  if (!(await canAccessProject(user, note.projectId))) {
    res.status(403).json({ error: "Sin acceso a esta obra" }); return;
  }

  const body = req.body as IncomingNoteBody;
  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    res.status(400).json({ error: "La nota debe tener al menos un concepto" }); return;
  }
  for (let i = 0; i < body.items.length; i++) {
    const err = validateItem(body.items[i], i);
    if (err) { res.status(400).json({ error: err }); return; }
  }

  const total = sumTotal(body.items);
  try {
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(materialNotesTable)
        .set({
          noteDate: body.noteDate ?? note.noteDate,
          folio: body.folio ?? null,
          supplierName: body.supplierName ?? null,
          description: body.description ?? null,
          totalAmount: total,
        })
        .where(eq(materialNotesTable.id, id))
        .returning();

      await tx.delete(materialsTable).where(eq(materialsTable.noteId, id));

      const itemRows = (body.items as IncomingItem[]).map((it) => ({
        projectId: note.projectId,
        requestedById: note.createdById,
        noteId: id,
        name: (it.name as string).trim(),
        description: it.description ?? null,
        unit: (it.unit as string).trim(),
        quantityRequested: it.quantityRequested as number,
        costPerUnit: it.costPerUnit ?? null,
        totalCost: it.costPerUnit != null
          ? (it.costPerUnit as number) * (it.quantityRequested as number)
          : null,
        notes: it.notes ?? null,
        status: "approved" as const,
        approvedById: note.createdById,
        approvedAt: new Date(),
      }));
      const inserted = await tx.insert(materialsTable).values(itemRows).returning();
      return { note: updated, items: inserted };
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "PATCH /material-notes/:id failed");
    res.status(500).json({ error: "No se pudo actualizar la nota" });
  }
});

/**
 * POST /api/material-notes/scan — OCR de notas de mostrador con IA.
 *
 * Body: { image: "data:image/jpeg;base64,..." }
 *
 * Llama a Gemini directo con un modelo de visión (default
 * gemini-2.5-flash, configurable vía GEMINI_VISION_MODEL).
 * Pide extraer cabecera y renglones de una nota de proveedor mexicana
 * (Cemex, Acero, ferreterías, etc.) y devuelve JSON estructurado listo
 * para pre-rellenar el formulario.
 *
 * El usuario SIEMPRE revisa el resultado antes de guardar — esto NO
 * crea la nota automáticamente, solo extrae los datos para que el
 * dueño confirme/corrija.
 *
 * Sin GEMINI_API_KEY configurada → 503 con mensaje claro. El
 * frontend muestra el botón como "próximamente" en ese caso.
 */
router.post("/material-notes/scan", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(user.role, "materialsRequest"))) {
    res.status(403).json({ error: "No tienes permiso para registrar materiales" });
    return;
  }

  // Motor único: Gemini directo (GEMINI_API_KEY). Sin llave → 503 claro.
  const geminiKey = process.env["GEMINI_API_KEY"];
  if (!geminiKey) {
    res.status(503).json({
      ok: false,
      pending: true,
      message: "El escaneo automático necesita que el administrador active el servicio. Puedes capturar los conceptos manualmente.",
    });
    return;
  }

  const { image } = req.body as { image?: string };
  if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
    res.status(400).json({ error: "Adjunta una foto válida (data URL)" });
    return;
  }
  // Protección de costo: rechazamos fotos > 4 MB del data URL.
  // Vercel ya rechaza requests > 4.5 MB al edge, así que cortamos un
  // poco antes con un mensaje propio. El check anterior de 11.2 MB
  // era código muerto (Vercel mataba antes).
  if (image.length > 4 * 1024 * 1024) {
    res.status(413).json({ error: "La foto es muy pesada. Toma una nueva con menos resolución." });
    return;
  }

  const started = Date.now();
  const reference = randomUUID().slice(0, 8);

  // AbortController explícito: si Gemini tarda demasiado (modelo
  // ocupado, factura con 20+ renglones, etc.), abortamos limpio en
  // 50 seg para que el catch agarre el error en vez de que Vercel
  // mate la función entera con un timeout opaco.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50_000);
  let model = process.env["GEMINI_VISION_MODEL"] ?? "gemini-2.5-flash";

  try {
    const gemini = await scanWithGemini(geminiKey, image, controller.signal);
    model = gemini.model;
    if (!gemini.ok) {
      logger.error({ status: gemini.status, code: gemini.code, model, reference }, "scan: Gemini rechazó la petición");
      res.status(502).json({ error: scanErrorMessage(gemini.status, gemini.code), reference });
      return;
    }

    const parsed = parseScanJson(gemini.text);
    if (!parsed) {
      logger.warn({ model, reference }, "scan: respuesta de Gemini no parseable");
      res.status(502).json({
        error: "No pudimos leer la foto. Asegúrate de que se vean los renglones y el folio. Mientras, captura los conceptos manualmente.",
      });
      return;
    }

    logger.info({ ms: Date.now() - started, itemCount: parsed.items.length, confidence: parsed.confidence, model }, "scan: extract completo (gemini)");
    res.json({ ok: true, ...parsed });
  } catch (err) {
    const ms = Date.now() - started;
    logger.error({ errorName: err instanceof Error ? err.name : "unknown", ms, model, reference }, "scan: excepción al llamar Gemini");
    // Mensajes humanos para los modos de falla comunes, para que soporte
    // y el cliente sepan qué pasó.
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || /aborted|timeout/i.test(err.message));
    const detail = err instanceof Error ? err.message : String(err);
    let userMessage = "No se pudo procesar la foto. Inténtalo de nuevo.";
    let status = 500;
    if (isAbort) {
      userMessage = "El servicio de visión tardó más de 50 segundos leyendo la nota. Inténtalo con una foto más nítida.";
      status = 504;
    } else if (/fetch|network|ENOTFOUND|ECONN/i.test(detail)) {
      userMessage = "No se pudo conectar con el servicio de visión. Revisa tu conexión.";
      status = 502;
    }
    res.status(status).json({
      error: userMessage,
      reference,
      elapsedMs: ms,
      model,
    });
  } finally {
    clearTimeout(timeoutId);
  }
});

export default router;
