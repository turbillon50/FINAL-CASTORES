import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import {
  db,
  usersTable,
  projectsTable,
  projectAssignmentsTable,
  checkInsTable,
  checkInQrTokensTable,
} from "@workspace/db";
import { getRequestUser } from "../lib/getRequestUser";
import { hasPermission } from "../lib/permissions";
import { checkGeofence } from "../lib/geofence";
import {
  hashPin,
} from "../lib/worker-auth";
import { logger } from "../lib/logger";
import { formatZodError } from "../lib/zodError";

const router: IRouter = Router();

// El endpoint público de login (worker_code + PIN) vive en auth.ts junto
// con los demás endpoints sin requireAuth (invite-login, forgot-password,
// etc.). Aquí solo viven los endpoints que ya tienen sesión.

// ──────────────────────────────────────────────────────────────────────────
// ADMIN: crear/actualizar credenciales de trabajador operativo
// POST /attendance/workers — alta sin email
// PUT  /attendance/workers/:id/credentials — reset PIN / regenera código
// ──────────────────────────────────────────────────────────────────────────
const CreateWorkerBody = z.object({
  name: z.string().min(2).max(100),
  pin: z.string().regex(/^\d{4}$/, "PIN debe ser 4 dígitos"),
  phone: z.string().optional(),
  company: z.string().optional(),
  projectIds: z.array(z.number().int().positive()).optional(),
});

async function generateUniqueWorkerCode(): Promise<string> {
  // Hasta 20 intentos: el espacio es 9000, así que la probabilidad de
  // colidir 20 veces seguidas con cientos de workers es < 10^-20.
  for (let i = 0; i < 20; i++) {
    const n = Math.floor(Math.random() * 9000) + 1000;
    const candidate = `CAS-${n}`;
    const [hit] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.workerCode, candidate));
    if (!hit) return candidate;
  }
  throw new Error("No se pudo generar un código único — espacio agotado");
}

router.post("/attendance/workers", async (req, res): Promise<void> => {
  const actor = await getRequestUser(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(actor.role, "workersManage"))) {
    res.status(403).json({ error: "No tienes permiso para crear trabajadores" });
    return;
  }
  const parsed = CreateWorkerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const { name, pin, phone, company, projectIds } = parsed.data;

  let workerCode: string;
  try {
    workerCode = await generateUniqueWorkerCode();
  } catch (err) {
    logger.error({ err }, "create worker: code generation failed");
    res.status(503).json({ error: "No se pudo generar el código del trabajador" });
    return;
  }

  const pinHash = await hashPin(pin);

  const [user] = await db
    .insert(usersTable)
    .values({
      name: name.trim(),
      // email queda NULL — workers operativos no tienen correo
      workerCode,
      pinHash,
      role: "worker",
      phone: phone?.trim() || undefined,
      company: company?.trim() || undefined,
      isActive: true,
      approvalStatus: "approved",
      // Términos: como no hay UX que se los enseñe en la PWA aún,
      // los marcamos aceptados a nombre de quien los dio de alta.
      // Si el negocio lo requiere, se puede mostrar un splash en
      // primer login que vuelva a pedir aceptación.
      termsAcceptedAt: new Date(),
      termsVersion: "1.0",
    })
    .returning();

  if (projectIds && projectIds.length > 0) {
    await db
      .insert(projectAssignmentsTable)
      .values(projectIds.map((pid) => ({ projectId: pid, userId: user.id, assignedBy: actor.id })))
      .onConflictDoNothing();
  }

  res.status(201).json({
    id: user.id,
    name: user.name,
    workerCode: user.workerCode,
    // Devolvemos el PIN una sola vez aquí para que el admin pueda
    // imprimirlo o pasárselo al trabajador. NO se vuelve a poder leer.
    pin,
    phone: user.phone,
    company: user.company,
    role: user.role,
  });
});

const ResetCredentialsBody = z.object({
  newPin: z.string().regex(/^\d{4}$/),
  regenerateCode: z.boolean().optional(),
});

router.put("/attendance/workers/:id/credentials", async (req, res): Promise<void> => {
  const actor = await getRequestUser(req);
  if (!actor) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(actor.role, "workersManage"))) {
    res.status(403).json({ error: "No tienes permiso para gestionar credenciales" });
    return;
  }
  const userId = Number(req.params["id"]);
  if (!Number.isFinite(userId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const parsed = ResetCredentialsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!target) { res.status(404).json({ error: "Trabajador no encontrado" }); return; }
  if (target.role !== "worker") {
    res.status(400).json({ error: "Solo se pueden resetear credenciales de trabajadores" });
    return;
  }

  const newHash = await hashPin(parsed.data.newPin);
  let newCode = target.workerCode;
  if (parsed.data.regenerateCode || !newCode) {
    newCode = await generateUniqueWorkerCode();
  }
  await db
    .update(usersTable)
    .set({ pinHash: newHash, workerCode: newCode, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  res.json({ id: userId, workerCode: newCode, pin: parsed.data.newPin });
});

// ──────────────────────────────────────────────────────────────────────────
// WORKER: contexto de mi sesión actual (obras asignadas + check-in abierto)
// ──────────────────────────────────────────────────────────────────────────
router.get("/attendance/me", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(user.role, "attendanceCheckIn"))) {
    res.status(403).json({ error: "No tienes permiso de asistencia" });
    return;
  }

  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
  if (!me) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  const assignedProjectIds = (
    await db
      .select({ pid: projectAssignmentsTable.projectId })
      .from(projectAssignmentsTable)
      .where(eq(projectAssignmentsTable.userId, user.id))
  ).map((r) => r.pid);

  const projects = assignedProjectIds.length > 0
    ? await db
        .select({
          id: projectsTable.id,
          name: projectsTable.name,
          location: projectsTable.location,
          latitude: projectsTable.latitude,
          longitude: projectsTable.longitude,
          geofenceRadiusMeters: projectsTable.geofenceRadiusMeters,
          geofenceMode: projectsTable.geofenceMode,
        })
        .from(projectsTable)
        .where(inArray(projectsTable.id, assignedProjectIds))
    : [];

  const [openCheckIn] = await db
    .select()
    .from(checkInsTable)
    .where(and(eq(checkInsTable.userId, user.id), isNull(checkInsTable.checkOutAt)))
    .orderBy(desc(checkInsTable.checkInAt))
    .limit(1);

  res.json({
    user: {
      id: me.id,
      name: me.name,
      role: me.role,
      workerCode: me.workerCode,
      avatarUrl: me.avatarUrl,
    },
    projects,
    openCheckIn: openCheckIn ?? null,
  });
});

// ──────────────────────────────────────────────────────────────────────────
// CHECK-IN: el worker llega a la obra
// ──────────────────────────────────────────────────────────────────────────
const CheckInBody = z.object({
  projectId: z.number().int().positive(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  // Acepta tanto URL pública como data URL base64 (la PWA del worker
  // comprime con `compressImageFile` y manda data:image/jpeg;base64,...
  // — el proyecto persiste imágenes de obra de la misma forma). Tope
  // 1 MB de string para no inflar la columna ni el body del POST.
  photoUrl: z.string().max(1_400_000).optional().or(z.literal("")),
  notes: z.string().max(500).optional(),
});

router.post("/attendance/check-in", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(user.role, "attendanceCheckIn"))) {
    res.status(403).json({ error: "No tienes permiso para registrar asistencia" });
    return;
  }
  const parsed = CheckInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const { projectId, latitude, longitude, accuracy, photoUrl, notes } = parsed.data;

  // No permitir dos check-ins abiertos en paralelo.
  const [existing] = await db
    .select({ id: checkInsTable.id, projectId: checkInsTable.projectId })
    .from(checkInsTable)
    .where(and(eq(checkInsTable.userId, user.id), isNull(checkInsTable.checkOutAt)));
  if (existing) {
    res.status(409).json({
      error: "Ya tienes una entrada abierta. Marca tu salida antes de iniciar otra.",
      openCheckInId: existing.id,
      openProjectId: existing.projectId,
    });
    return;
  }

  // Verificar asignación: el worker solo puede registrar en obras donde
  // está asignado. Admins/supervisors entran por la ruta manual (más abajo).
  const [assignment] = await db
    .select({ id: projectAssignmentsTable.id })
    .from(projectAssignmentsTable)
    .where(and(eq(projectAssignmentsTable.userId, user.id), eq(projectAssignmentsTable.projectId, projectId)));
  if (!assignment) {
    res.status(403).json({ error: "No estás asignado a esta obra" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Obra no encontrada" }); return; }

  const geo = checkGeofence({
    projectLatitude: project.latitude,
    projectLongitude: project.longitude,
    geofenceRadiusMeters: project.geofenceRadiusMeters,
    geofenceMode: project.geofenceMode as "strict" | "tolerant" | "off",
    userLatitude: latitude,
    userLongitude: longitude,
    userAccuracy: accuracy ?? null,
  });

  if (geo.decision === "rejected") {
    res.status(422).json({
      error: "Estás fuera del rango de la obra. Acércate al frente de obra e intenta de nuevo.",
      detail: geo.reason,
      distanceMeters: Math.round(geo.distanceMeters),
      allowedRadiusMeters: project.geofenceRadiusMeters,
    });
    return;
  }

  const [row] = await db
    .insert(checkInsTable)
    .values({
      userId: user.id,
      projectId,
      checkInLatitude: latitude,
      checkInLongitude: longitude,
      checkInAccuracy: accuracy ?? null,
      checkInDistanceMeters: geo.distanceMeters ?? null,
      checkInPhotoUrl: photoUrl?.trim() || null,
      checkInStatus: geo.decision === "flagged" ? "flagged" : "ok",
      checkInNotes: notes?.trim() || null,
    })
    .returning();

  res.status(201).json({
    checkIn: row,
    project: { id: project.id, name: project.name, location: project.location },
    geofence: { decision: geo.decision, reason: geo.decision !== "ok" ? geo.reason : null },
  });
});

// ──────────────────────────────────────────────────────────────────────────
// CHECK-OUT: el worker se va. Opcionalmente con QR del supervisor.
// ──────────────────────────────────────────────────────────────────────────
const CheckOutBody = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  // Acepta tanto URL pública como data URL base64 (la PWA del worker
  // comprime con `compressImageFile` y manda data:image/jpeg;base64,...
  // — el proyecto persiste imágenes de obra de la misma forma). Tope
  // 1 MB de string para no inflar la columna ni el body del POST.
  photoUrl: z.string().max(1_400_000).optional().or(z.literal("")),
  notes: z.string().max(500).optional(),
  qrToken: z.string().optional(),
});

router.post("/attendance/check-out", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(user.role, "attendanceCheckIn"))) {
    res.status(403).json({ error: "No tienes permiso para registrar asistencia" });
    return;
  }
  const parsed = CheckOutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const { latitude, longitude, accuracy, photoUrl, notes, qrToken } = parsed.data;

  const [open] = await db
    .select()
    .from(checkInsTable)
    .where(and(eq(checkInsTable.userId, user.id), isNull(checkInsTable.checkOutAt)))
    .orderBy(desc(checkInsTable.checkInAt))
    .limit(1);
  if (!open) {
    res.status(404).json({ error: "No tienes ninguna entrada abierta para cerrar" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, open.projectId));
  if (!project) {
    res.status(404).json({ error: "La obra de tu entrada ya no existe" });
    return;
  }

  // Si manda QR, debe ser válido y de esta obra.
  let validatedBy: number | null = null;
  if (qrToken) {
    const [qr] = await db
      .select()
      .from(checkInQrTokensTable)
      .where(eq(checkInQrTokensTable.token, qrToken));
    if (!qr) {
      res.status(400).json({ error: "Código QR inválido" });
      return;
    }
    if (qr.projectId !== open.projectId) {
      res.status(400).json({ error: "El QR es de otra obra" });
      return;
    }
    if (qr.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "El QR caducó. Pide al supervisor uno nuevo." });
      return;
    }
    if (qr.redeemedAt) {
      res.status(400).json({ error: "Este QR ya fue usado. Pide uno nuevo." });
      return;
    }
    await db
      .update(checkInQrTokensTable)
      .set({ redeemedAt: new Date(), redeemedBy: user.id })
      .where(eq(checkInQrTokensTable.id, qr.id));
    validatedBy = qr.issuedBy;
  }

  const geo = checkGeofence({
    projectLatitude: project.latitude,
    projectLongitude: project.longitude,
    geofenceRadiusMeters: project.geofenceRadiusMeters,
    geofenceMode: project.geofenceMode as "strict" | "tolerant" | "off",
    userLatitude: latitude,
    userLongitude: longitude,
    userAccuracy: accuracy ?? null,
  });

  // Si tiene QR válido, no bloqueamos por geofence (el supervisor ya validó
  // presencialmente). Sin QR, en modo strict el geofence aplica.
  if (!qrToken && geo.decision === "rejected") {
    res.status(422).json({
      error: "Estás fuera del rango de la obra. Acércate al frente de obra o pide al supervisor que te muestre el QR.",
      detail: geo.reason,
      distanceMeters: Math.round(geo.distanceMeters),
      allowedRadiusMeters: project.geofenceRadiusMeters,
    });
    return;
  }

  const now = new Date();
  const totalMinutes = Math.max(0, Math.round((now.getTime() - open.checkInAt.getTime()) / 60_000));
  const finalStatus = qrToken ? "ok" : (geo.decision === "flagged" ? "flagged" : "ok");

  const [updated] = await db
    .update(checkInsTable)
    .set({
      checkOutAt: now,
      checkOutLatitude: latitude,
      checkOutLongitude: longitude,
      checkOutAccuracy: accuracy ?? null,
      checkOutDistanceMeters: geo.distanceMeters ?? null,
      checkOutPhotoUrl: photoUrl?.trim() || null,
      checkOutStatus: finalStatus,
      checkOutNotes: notes?.trim() || null,
      checkOutValidatedBy: validatedBy,
      totalMinutes,
    })
    .where(eq(checkInsTable.id, open.id))
    .returning();

  res.json({
    checkIn: updated,
    totalMinutes,
    project: { id: project.id, name: project.name },
  });
});

// ──────────────────────────────────────────────────────────────────────────
// QR: el supervisor genera un token efímero (2 min) para validar salidas
// ──────────────────────────────────────────────────────────────────────────
const QR_TTL_MS = 2 * 60 * 1000;

router.post("/attendance/qr", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(user.role, "attendanceGenerateQr"))) {
    res.status(403).json({ error: "No tienes permiso para generar QR de asistencia" });
    return;
  }
  const parsed = z.object({ projectId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const [project] = await db.select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable).where(eq(projectsTable.id, parsed.data.projectId));
  if (!project) { res.status(404).json({ error: "Obra no encontrada" }); return; }

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + QR_TTL_MS);
  const [row] = await db
    .insert(checkInQrTokensTable)
    .values({ token, projectId: project.id, issuedBy: user.id, expiresAt })
    .returning();

  res.status(201).json({
    token: row.token,
    projectId: row.projectId,
    projectName: project.name,
    expiresAt: row.expiresAt,
    ttlSeconds: Math.round(QR_TTL_MS / 1000),
  });
});

// ──────────────────────────────────────────────────────────────────────────
// DASHBOARD: lista de check-ins (filtrable por obra/fecha/estado)
// ──────────────────────────────────────────────────────────────────────────
const ListQuery = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  from: z.string().optional(),          // ISO date 'YYYY-MM-DD'
  to: z.string().optional(),
  status: z.enum(["open", "closed", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get("/attendance", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(user.role, "attendanceViewAll"))) {
    res.status(403).json({ error: "No tienes permiso para ver asistencia" });
    return;
  }

  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const { projectId, userId, from, to, status, limit } = parsed.data;

  const conditions = [];
  if (projectId) conditions.push(eq(checkInsTable.projectId, projectId));
  if (userId) conditions.push(eq(checkInsTable.userId, userId));
  if (from) conditions.push(gte(checkInsTable.checkInAt, new Date(`${from}T00:00:00Z`)));
  if (to) conditions.push(lte(checkInsTable.checkInAt, new Date(`${to}T23:59:59Z`)));
  if (status === "open") conditions.push(isNull(checkInsTable.checkOutAt));
  if (status === "closed") conditions.push(sql`${checkInsTable.checkOutAt} IS NOT NULL`);

  const rows = await db
    .select({
      ci: checkInsTable,
      userName: usersTable.name,
      userWorkerCode: usersTable.workerCode,
      projectName: projectsTable.name,
    })
    .from(checkInsTable)
    .leftJoin(usersTable, eq(usersTable.id, checkInsTable.userId))
    .leftJoin(projectsTable, eq(projectsTable.id, checkInsTable.projectId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(checkInsTable.checkInAt))
    .limit(limit);

  res.json(rows.map((r) => ({
    ...r.ci,
    userName: r.userName,
    userWorkerCode: r.userWorkerCode,
    projectName: r.projectName,
  })));
});

// ──────────────────────────────────────────────────────────────────────────
// EXPORT CSV: para nómina
// ──────────────────────────────────────────────────────────────────────────
const ExportQuery = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  from: z.string(),  // YYYY-MM-DD requerido
  to: z.string(),
});

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.get("/attendance/export.csv", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user) { res.status(401).json({ error: "No autenticado" }); return; }
  if (!(await hasPermission(user.role, "attendanceExport"))) {
    res.status(403).json({ error: "No tienes permiso para exportar asistencia" });
    return;
  }
  const parsed = ExportQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }
  const { projectId, from, to } = parsed.data;

  const conditions = [
    gte(checkInsTable.checkInAt, new Date(`${from}T00:00:00Z`)),
    lte(checkInsTable.checkInAt, new Date(`${to}T23:59:59Z`)),
  ];
  if (projectId) conditions.push(eq(checkInsTable.projectId, projectId));

  const rows = await db
    .select({
      ci: checkInsTable,
      userName: usersTable.name,
      userCode: usersTable.workerCode,
      projectName: projectsTable.name,
    })
    .from(checkInsTable)
    .leftJoin(usersTable, eq(usersTable.id, checkInsTable.userId))
    .leftJoin(projectsTable, eq(projectsTable.id, checkInsTable.projectId))
    .where(and(...conditions))
    .orderBy(desc(checkInsTable.checkInAt));

  const header = [
    "Trabajador", "Codigo", "Obra", "Entrada", "Salida", "Minutos",
    "Estado entrada", "Estado salida", "Notas",
  ];
  const csv = [
    header.join(","),
    ...rows.map((r) => [
      csvCell(r.userName),
      csvCell(r.userCode),
      csvCell(r.projectName),
      csvCell(r.ci.checkInAt.toISOString()),
      csvCell(r.ci.checkOutAt?.toISOString() ?? ""),
      csvCell(r.ci.totalMinutes ?? ""),
      csvCell(r.ci.checkInStatus),
      csvCell(r.ci.checkOutStatus ?? ""),
      csvCell([r.ci.checkInNotes, r.ci.checkOutNotes].filter(Boolean).join(" / ")),
    ].join(",")),
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="asistencia_${from}_${to}.csv"`);
  res.send(csv);
});

export default router;
