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
 * Llama a OpenRouter con un modelo de visión (default
 * anthropic/claude-sonnet-4-5, configurable vía OPENROUTER_VISION_MODEL).
 * Pide extraer cabecera y renglones de una nota de proveedor mexicana
 * (Cemex, Acero, ferreterías, etc.) y devuelve JSON estructurado listo
 * para pre-rellenar el formulario.
 *
 * El usuario SIEMPRE revisa el resultado antes de guardar — esto NO
 * crea la nota automáticamente, solo extrae los datos para que el
 * dueño confirme/corrija.
 *
 * Sin OPENROUTER_API_KEY configurada → 503 con mensaje claro. El
 * frontend muestra el botón como "próximamente" en ese caso.
 */
const SCAN_SYSTEM_PROMPT = `Eres un asistente experto en leer notas, recibos, facturas y remisiones de proveedores de construcción mexicanos. La imagen puede ser:
- Una foto directa de una nota física (papel)
- Un screenshot de una imagen que el proveedor mandó por WhatsApp / correo
- Una factura PDF capturada como imagen
- Notas impresas o escritas a mano, con tachones, sellos o firmas

Tu trabajo es EXTRAER de forma intuitiva los conceptos comprados, aunque la imagen esté arrugada, mal iluminada, o tenga formato libre. Usa contexto: si dice "5 ton de cemento gris 50kg" eso es 5 toneladas (unidad=ton, qty=5, name="Cemento gris 50kg").

Devuelve EXCLUSIVAMENTE un objeto JSON con esta forma exacta:
{
  "supplierName": string | null,    // nombre del proveedor en mayúsculas si lo ves
  "folio": string | null,           // número de folio / nota / remisión / factura
  "noteDate": string | null,        // ISO YYYY-MM-DD si puedes inferir; "2024-05-12" no "12/5/24"
  "items": [
    {
      "name": string,               // descripción del concepto. p. ej. "Acero 5/8 grado 60", "Cemento gris 50kg", "Varilla corrugada 3/8"
      "unit": string,                // "kg", "ton", "saco", "pza", "m³", "m", "varilla", "lt", "caja", "rollo"
      "quantityRequested": number,   // cantidad numérica (no string)
      "costPerUnit": number | null   // precio unitario en MXN sin signo de pesos
    }
  ],
  "confidence": number               // 0..1 — qué tan seguro estás del extract completo
}

Reglas inteligentes:
- Si solo ves el TOTAL del renglón y la cantidad, divide para sacar el unitario.
- Si solo ves el total general y un renglón, asume que ese total es del renglón.
- Unidades en español, minúsculas: "kgs"→"kg", "Tons"→"ton", "SACOS"→"saco", "PZAS"→"pza".
- Si no ves precio (solo conceptos y cantidades), pon costPerUnit: null. NO inventes.
- Si la imagen es ilegible / no es una nota / no se distingue nada útil, devuelve items: [] y confidence: 0.
- Importante: SOLO el JSON, sin markdown fences, sin texto antes o después.`;

type ScanResponse = {
  supplierName: string | null;
  folio: string | null;
  noteDate: string | null;
  items: Array<{
    name: string;
    unit: string;
    quantityRequested: number;
    costPerUnit: number | null;
  }>;
  confidence: number;
};

function parseScanJson(raw: string): ScanResponse | null {
  // Algunos modelos siguen agregando ```json wrappers o texto antes/después.
  // Buscamos el primer { y el último } para extraer el JSON crudo.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = raw.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as Partial<ScanResponse>;
    if (!Array.isArray(parsed.items)) return null;

    // Validación de números: el modelo puede devolver NaN/Infinity
    // string o números fuera de rango. Filtramos a finitos > 0 para
    // que la cantidad y el costo se puedan multiplicar sin riesgo.
    // Cualquier renglón con quantityRequested inválido se descarta.
    const validItems = parsed.items
      .filter((it): it is { name: string; unit: string; quantityRequested: number; costPerUnit: number | null } =>
        !!it &&
        typeof it.name === "string" && it.name.trim().length > 0 &&
        typeof it.unit === "string" && it.unit.trim().length > 0 &&
        typeof it.quantityRequested === "number" &&
        Number.isFinite(it.quantityRequested) &&
        it.quantityRequested > 0,
      )
      .map((it) => ({
        name: it.name.trim(),
        unit: it.unit.trim().toLowerCase(),
        quantityRequested: it.quantityRequested,
        costPerUnit:
          typeof it.costPerUnit === "number" && Number.isFinite(it.costPerUnit) && it.costPerUnit >= 0
            ? it.costPerUnit
            : null,
      }));

    return {
      supplierName: typeof parsed.supplierName === "string" && parsed.supplierName.trim() ? parsed.supplierName.trim() : null,
      folio: typeof parsed.folio === "string" && parsed.folio.trim() ? parsed.folio.trim() : null,
      noteDate: typeof parsed.noteDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.noteDate) ? parsed.noteDate : null,
      items: validItems,
      confidence:
        typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
    };
  } catch {
    return null;
  }
}

router.post("/material-notes/scan", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(user.role, "materialsRequest"))) {
    res.status(403).json({ error: "No tienes permiso para registrar materiales" });
    return;
  }

  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) {
    res.status(503).json({
      ok: false,
      pending: true,
      message: "El escaneo automático aún no está configurado. Captura los conceptos manualmente — el admin lo activará cuando agregue la llave del servicio.",
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

  // Default `google/gemini-2.5-flash` — el sweet spot precio/rendimiento
  // de OpenRouter para OCR:
  //   • ~$0.0001 USD por imagen (5,000 facturas = 50¢)
  //   • Latencia 3-5 seg (vs 20-25 seg de claude-sonnet)
  //   • OCR excelente en español, lee manuscrito y facturas impresas
  //   • Devuelve JSON estructurado limpio
  // El admin puede subir a `anthropic/claude-sonnet-4` si requiere más
  // precisión en notas muy mal iluminadas, a costo de ~25x el precio
  // y 5x el tiempo. Para el 99% de los casos gemini-2.5-flash sobra.
  const model = process.env["OPENROUTER_VISION_MODEL"] ?? "google/gemini-2.5-flash";
  const started = Date.now();

  // AbortController explícito: si OpenRouter tarda demasiado (modelo
  // ocupado, factura con 20+ renglones, etc.), abortamos limpio en
  // 50 seg para que el catch agarre el error en vez de que Vercel
  // mate la función entera con un timeout opaco.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50_000);

  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        // OpenRouter pide HTTP-Referer + X-Title como buena práctica para
        // aparecer correctamente en su dashboard de uso.
        "HTTP-Referer": "https://castores.info",
        "X-Title": "Castores Control — Note OCR",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: SCAN_SYSTEM_PROMPT },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        // temperature baja: queremos extraer lo que está, no inventar.
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!orRes.ok) {
      const detail = await orRes.text().catch(() => "");
      logger.error({ status: orRes.status, detail: detail.slice(0, 500), model }, "scan: OpenRouter rechazó la petición");
      // Damos diagnóstico real al frontend para no dejar al usuario
      // sin pistas. Cubrimos los casos comunes que vimos:
      //  401 → key inválida / sin créditos
      //  402 → sin saldo en OpenRouter
      //  404 → modelo mal escrito (variable de entorno OPENROUTER_VISION_MODEL)
      //  413 → imagen muy grande
      //  429 → rate limit
      let userMessage = "El servicio de visión rechazó la foto. Inténtalo de nuevo en un momento.";
      if (orRes.status === 401) userMessage = "API key de OpenRouter inválida o sin permisos. Avísale al administrador.";
      else if (orRes.status === 402) userMessage = "OpenRouter sin saldo. Avísale al administrador para recargar.";
      else if (orRes.status === 404) userMessage = `Modelo "${model}" no existe en OpenRouter. Revisa la variable OPENROUTER_VISION_MODEL.`;
      else if (orRes.status === 413) userMessage = "La foto es muy pesada. Tómala con menos resolución.";
      else if (orRes.status === 429) userMessage = "Demasiados escaneos en poco tiempo. Espera 30 segundos.";
      else if (orRes.status >= 500) userMessage = "OpenRouter está caído. Captura manual por ahora.";
      res.status(502).json({
        error: userMessage,
        diagnostic: `HTTP ${orRes.status}: ${detail.slice(0, 200)}`,
      });
      return;
    }

    const data = (await orRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = parseScanJson(content);

    if (!parsed) {
      logger.warn({ model, content: content.slice(0, 300) }, "scan: respuesta del modelo no parseable");
      res.status(502).json({
        error: "No pudimos leer la foto. Asegúrate de que se vean los renglones y el folio. Mientras, captura los conceptos manualmente.",
      });
      return;
    }

    logger.info({
      ms: Date.now() - started,
      itemCount: parsed.items.length,
      confidence: parsed.confidence,
      model,
      tokens: data.usage,
    }, "scan: extract completo");

    res.json({ ok: true, ...parsed });
  } catch (err) {
    const ms = Date.now() - started;
    logger.error({ err, ms, model }, "scan: excepción al llamar OpenRouter");
    // Mensajes humanos para los modos de falla comunes. Antes mostrábamos
    // un genérico "No se pudo procesar la foto" que no permitía ni a
    // soporte ni al cliente saber qué fue lo que pasó.
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || /aborted|timeout/i.test(err.message));
    const detail = err instanceof Error ? err.message : String(err);
    let userMessage = "No se pudo procesar la foto. Inténtalo de nuevo.";
    let status = 500;
    if (isAbort) {
      userMessage = `El servicio de visión tardó más de 50 segundos leyendo la nota. Inténtalo con una foto más nítida o un modelo más rápido (cambia OPENROUTER_VISION_MODEL a google/gemini-2.5-flash).`;
      status = 504;
    } else if (/fetch|network|ENOTFOUND|ECONN/i.test(detail)) {
      userMessage = "No se pudo conectar con OpenRouter. Revisa tu conexión.";
      status = 502;
    }
    res.status(status).json({
      error: userMessage,
      diagnostic: detail.slice(0, 240),
      elapsedMs: ms,
      model,
    });
  } finally {
    clearTimeout(timeoutId);
  }
});

export default router;
