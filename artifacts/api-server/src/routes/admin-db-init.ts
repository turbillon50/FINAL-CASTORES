import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

const ADMIN_MASTER_KEY = (
  process.env["ADMIN_ACCESS_PHRASE"] ||
  process.env["ADMIN_MASTER_KEY"] ||
  ""
).trim().toUpperCase();
const LEGACY_MASTER_KEY = "CASTORES";

function isMasterAdminKey(rawCode: string): boolean {
  const normalized = rawCode.trim().toUpperCase();
  return normalized === LEGACY_MASTER_KEY || (!!ADMIN_MASTER_KEY && normalized === ADMIN_MASTER_KEY);
}

export const INIT_SQL = `-- ============================================================
-- CASTORES — Init schema (12 tablas)
-- ============================================================

CREATE TABLE IF NOT EXISTS "users" (
  "id" serial PRIMARY KEY,
  "clerk_id" text UNIQUE,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "password_hash" text,
  "role" text NOT NULL DEFAULT 'worker',
  "phone" text,
  "avatar_url" text,
  "company" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "approval_status" text NOT NULL DEFAULT 'approved',
  "approved_by" text,
  "approved_at" timestamptz,
  "terms_accepted_at" timestamptz,
  "terms_version" text,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "invitation_codes" (
  "id" serial PRIMARY KEY,
  "code" text NOT NULL UNIQUE,
  "role" text NOT NULL,
  "label" text,
  "created_by" integer NOT NULL,
  "used_by" integer,
  "used_at" timestamptz,
  "expires_at" timestamptz,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "role_permissions" (
  "role" text PRIMARY KEY,
  "permissions" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "projects" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "description" text,
  "client_id" integer,
  "supervisor_id" integer,
  "location" text,
  "latitude" real,
  "longitude" real,
  "start_date" text,
  "end_date" text,
  "budget" real,
  "spent_amount" real DEFAULT 0,
  "progress_percent" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "cover_image_url" text,
  "gallery_images" text[] DEFAULT '{}',
  "milestones" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

-- Migración idempotente: agrega galería y milestones si la tabla
-- ya existía sin esas columnas (caso típico al desplegar este cambio
-- sobre la DB de producción que se creó antes).
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "gallery_images" text[] DEFAULT '{}';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "milestones" jsonb DEFAULT '[]'::jsonb;

-- Migración idempotente: dinero de real (float32, ~7 dígitos) a double
-- precision (float64, ~15 dígitos exactos) para que centavos no se
-- redondeen en montos arriba de ~10 millones. PostgreSQL convierte
-- el valor existente en-place sin pérdida.
ALTER TABLE "projects" ALTER COLUMN "budget" TYPE double precision USING "budget"::double precision;
ALTER TABLE "projects" ALTER COLUMN "spent_amount" TYPE double precision USING "spent_amount"::double precision;

CREATE TABLE IF NOT EXISTS "activity_log" (
  "id" serial PRIMARY KEY,
  "type" text NOT NULL,
  "description" text NOT NULL,
  "user_id" integer,
  "project_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "content_items" (
  "id" serial PRIMARY KEY,
  "type" text NOT NULL DEFAULT 'announcement',
  "title" text NOT NULL,
  "body" text,
  "image_url" text,
  "link_url" text,
  "target_role" text,
  "category" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "documents" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL,
  "uploaded_by_id" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "category" text NOT NULL DEFAULT 'other',
  "file_url" text NOT NULL,
  "file_type" text NOT NULL,
  "file_size" integer,
  "created_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "materials" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL,
  "requested_by_id" integer NOT NULL,
  "note_id" integer,
  "name" text NOT NULL,
  "description" text,
  "unit" text NOT NULL,
  "quantity_requested" double precision NOT NULL,
  "quantity_approved" double precision,
  "quantity_used" double precision,
  "cost_per_unit" double precision,
  "total_cost" double precision,
  "status" text NOT NULL DEFAULT 'pending',
  "approved_by_id" integer,
  "approved_at" timestamptz,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

-- Idempotente para producción existente: convertir columnas de dinero
-- de real a double precision y agregar note_id para asociar renglones
-- a una nota de mostrador (capturas múltiples conceptos en una sola).
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "note_id" integer;
-- Backfill idempotente: los materiales que viven dentro de una nota de
-- mostrador representan un gasto ya hecho. Cuando se introdujo la
-- nueva tabla material_notes, los items se creaban en status='pending',
-- lo que dejaba FINANZAS marcando $0 aunque el dinero ya salió. Aquí
-- los promovemos a 'approved' una sola vez. Es seguro re-ejecutar:
-- solo afecta filas con note_id != NULL que sigan en 'pending'; si en
-- algún flujo futuro se decide volver una nota a pending, esta query
-- la re-aprobaría — eso lo manejamos solo si se vuelve un caso real.
UPDATE "materials" SET "status" = 'approved'
  WHERE "note_id" IS NOT NULL AND "status" = 'pending';
ALTER TABLE "materials" ALTER COLUMN "quantity_requested" TYPE double precision USING "quantity_requested"::double precision;
ALTER TABLE "materials" ALTER COLUMN "quantity_approved" TYPE double precision USING "quantity_approved"::double precision;
ALTER TABLE "materials" ALTER COLUMN "quantity_used" TYPE double precision USING "quantity_used"::double precision;
ALTER TABLE "materials" ALTER COLUMN "cost_per_unit" TYPE double precision USING "cost_per_unit"::double precision;
ALTER TABLE "materials" ALTER COLUMN "total_cost" TYPE double precision USING "total_cost"::double precision;

-- Tabla nueva: cabecera de notas de mostrador. Una nota agrupa varios
-- renglones en materials (via materials.note_id). El total se persiste
-- al insertar/actualizar para evitar recomputar en lectura.
CREATE TABLE IF NOT EXISTS "material_notes" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL,
  "created_by_id" integer NOT NULL,
  "note_date" text NOT NULL,
  "folio" text,
  "supplier_name" text,
  "description" text,
  "total_amount" double precision NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft',
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "type" text NOT NULL DEFAULT 'general',
  "related_id" integer,
  "related_type" text,
  "is_read" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "project_assignments" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "assigned_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_assignments_unique" ON "project_assignments" ("project_id", "user_id");

CREATE TABLE IF NOT EXISTS "reports" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL,
  "generated_by_id" integer NOT NULL,
  "title" text NOT NULL,
  "type" text NOT NULL,
  "date_from" text,
  "date_to" text,
  "summary" text,
  "file_url" text,
  "created_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "work_logs" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL,
  "supervisor_id" integer NOT NULL,
  "log_date" text NOT NULL,
  "activity" text NOT NULL,
  "observations" text,
  "workers_involved" text,
  "materials_used" text,
  "photos" text[] DEFAULT '{}',
  "supervisor_signature" text,
  "client_signature" text,
  "is_submitted" boolean NOT NULL DEFAULT false,
  "submitted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "last_used_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_unique"
  ON "push_subscriptions" ("endpoint");

-- ============================================================
-- ASISTENCIA (Geocheck) — columnas y tablas nuevas
-- ============================================================
-- Workers operativos pueden entrar sin correo electrónico: se identifican
-- con worker_code + PIN. Hacemos email NULLable y agregamos las columnas
-- nuevas (sin DEFAULT — los workers Clerk legacy ya tienen email, y los
-- workers operativos se crean con worker_code desde Admin → Equipo).
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "worker_code" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pin_hash" text;
-- UNIQUE en worker_code: Postgres permite múltiples NULLs en columnas UNIQUE,
-- así que los users Clerk (sin worker_code) coexisten con los operativos.
CREATE UNIQUE INDEX IF NOT EXISTS "users_worker_code_unique" ON "users" ("worker_code");

-- Geocerca por obra. Default 100 m + modo 'strict' replicado del schema.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "geofence_radius_meters" integer NOT NULL DEFAULT 100;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "geofence_mode" text NOT NULL DEFAULT 'strict';

CREATE TABLE IF NOT EXISTS "check_ins" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL,
  "project_id" integer NOT NULL,
  "check_in_at" timestamptz NOT NULL DEFAULT NOW(),
  "check_in_latitude" real,
  "check_in_longitude" real,
  "check_in_accuracy" real,
  "check_in_distance_meters" real,
  "check_in_photo_url" text,
  "check_in_status" text NOT NULL DEFAULT 'ok',
  "check_in_notes" text,
  "check_out_at" timestamptz,
  "check_out_latitude" real,
  "check_out_longitude" real,
  "check_out_accuracy" real,
  "check_out_distance_meters" real,
  "check_out_photo_url" text,
  "check_out_status" text,
  "check_out_notes" text,
  "check_out_validated_by" integer,
  "total_minutes" integer,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "check_ins_user_open_idx" ON "check_ins" ("user_id", "check_out_at");
CREATE INDEX IF NOT EXISTS "check_ins_project_date_idx" ON "check_ins" ("project_id", "check_in_at");

CREATE TABLE IF NOT EXISTS "check_in_qr_tokens" (
  "id" serial PRIMARY KEY,
  "token" text NOT NULL UNIQUE,
  "project_id" integer NOT NULL,
  "issued_by" integer NOT NULL,
  "purpose" text NOT NULL DEFAULT 'checkout',
  "expires_at" timestamptz NOT NULL,
  "redeemed_at" timestamptz,
  "redeemed_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "qr_tokens_project_idx" ON "check_in_qr_tokens" ("project_id");
CREATE INDEX IF NOT EXISTS "qr_tokens_expiry_idx" ON "check_in_qr_tokens" ("expires_at");`;

// Seed: matriz de permisos por defecto para los 5 roles. Idempotente.
//
// ON CONFLICT DO NOTHING preserva los permisos que el admin haya editado en
// runtime — pero los roles ya existentes no recibirán los flags NUEVOS que
// agreguemos en deploys posteriores (attendance*, futuros). Para evitar
// "rol con permisos viejos sin attendance*", hacemos un segundo UPDATE que
// hace merge: solo añade los keys faltantes, nunca pisa los true/false que
// el admin ya configuró. Es idempotente: re-ejecutarlo no cambia nada.
export const SEED_ROLE_PERMISSIONS_SQL = `
INSERT INTO role_permissions (role, permissions) VALUES
  ('admin', '{"dashboardFull":true,"projectsViewAll":true,"projectsCreateEdit":true,"bitacoraView":true,"bitacoraCreate":true,"budgetViewAmounts":true,"materialsApprove":true,"materialsRequest":true,"materialsSupply":true,"workersView":true,"workersManage":true,"documentsLegalView":true,"documentsLegalManage":true,"adminPanelAccess":true,"attendanceCheckIn":false,"attendanceGenerateQr":true,"attendanceViewAll":true,"attendanceExport":true}'::jsonb),
  ('supervisor', '{"dashboardFull":true,"projectsViewAll":true,"projectsCreateEdit":false,"bitacoraView":true,"bitacoraCreate":true,"budgetViewAmounts":true,"materialsApprove":false,"materialsRequest":true,"materialsSupply":false,"workersView":true,"workersManage":false,"documentsLegalView":true,"documentsLegalManage":false,"adminPanelAccess":false,"attendanceCheckIn":false,"attendanceGenerateQr":true,"attendanceViewAll":true,"attendanceExport":false}'::jsonb),
  ('client', '{"dashboardFull":false,"projectsViewAll":false,"projectsCreateEdit":false,"bitacoraView":true,"bitacoraCreate":false,"budgetViewAmounts":true,"materialsApprove":false,"materialsRequest":false,"materialsSupply":false,"workersView":false,"workersManage":false,"documentsLegalView":true,"documentsLegalManage":false,"adminPanelAccess":false,"attendanceCheckIn":false,"attendanceGenerateQr":false,"attendanceViewAll":false,"attendanceExport":false}'::jsonb),
  ('worker', '{"dashboardFull":false,"projectsViewAll":false,"projectsCreateEdit":false,"bitacoraView":true,"bitacoraCreate":true,"budgetViewAmounts":false,"materialsApprove":false,"materialsRequest":false,"materialsSupply":false,"workersView":false,"workersManage":false,"documentsLegalView":false,"documentsLegalManage":false,"adminPanelAccess":false,"attendanceCheckIn":true,"attendanceGenerateQr":false,"attendanceViewAll":false,"attendanceExport":false}'::jsonb),
  ('proveedor', '{"dashboardFull":false,"projectsViewAll":false,"projectsCreateEdit":false,"bitacoraView":false,"bitacoraCreate":false,"budgetViewAmounts":false,"materialsApprove":false,"materialsRequest":false,"materialsSupply":true,"workersView":false,"workersManage":false,"documentsLegalView":true,"documentsLegalManage":false,"adminPanelAccess":false,"attendanceCheckIn":false,"attendanceGenerateQr":false,"attendanceViewAll":false,"attendanceExport":false}'::jsonb)
ON CONFLICT (role) DO NOTHING;

-- Backfill: agrega los keys nuevos a cualquier rol que ya existía. jsonb ||
-- hace merge con prioridad al lado derecho, así que las keys que el admin
-- ya configuró sobreviven (las dejamos del lado derecho).
UPDATE role_permissions SET permissions =
  ('{"attendanceCheckIn":false,"attendanceGenerateQr":true,"attendanceViewAll":true,"attendanceExport":true}'::jsonb || permissions)
  WHERE role = 'admin';
UPDATE role_permissions SET permissions =
  ('{"attendanceCheckIn":false,"attendanceGenerateQr":true,"attendanceViewAll":true,"attendanceExport":false}'::jsonb || permissions)
  WHERE role = 'supervisor';
UPDATE role_permissions SET permissions =
  ('{"attendanceCheckIn":false,"attendanceGenerateQr":false,"attendanceViewAll":false,"attendanceExport":false}'::jsonb || permissions)
  WHERE role = 'client';
UPDATE role_permissions SET permissions =
  ('{"attendanceCheckIn":true,"attendanceGenerateQr":false,"attendanceViewAll":false,"attendanceExport":false}'::jsonb || permissions)
  WHERE role = 'worker';
UPDATE role_permissions SET permissions =
  ('{"attendanceCheckIn":false,"attendanceGenerateQr":false,"attendanceViewAll":false,"attendanceExport":false}'::jsonb || permissions)
  WHERE role = 'proveedor';
`;

/**
 * POST /api/admin/db-init
 * One-shot endpoint to initialize the database schema and seed role permissions.
 * Protected by the admin master phrase. Idempotent.
 * Body: { phrase: "CASTORES" }
 */
router.post("/admin/db-init", async (req, res): Promise<void> => {
  const { phrase } = req.body as { phrase?: string };
  if (!phrase || !isMasterAdminKey(phrase)) {
    res.status(403).json({ error: "Frase inválida" });
    return;
  }

  try {
    const client = await pool.connect();
    try {
      // 1. Create all tables
      await client.query(INIT_SQL);
      // 2. Seed default role permissions for the 5 roles
      await client.query(SEED_ROLE_PERMISSIONS_SQL);
      // 3. Report state
      const t = await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
      );
      const r = await client.query(
        "SELECT role, permissions FROM role_permissions ORDER BY role"
      );
      res.json({
        ok: true,
        tablesCreated: t.rows.length,
        tables: t.rows.map((r: { tablename: string }) => r.tablename),
        rolesSeeded: r.rows.length,
        roles: r.rows.map((row: { role: string }) => row.role),
      });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string };
    res.status(500).json({ error: e.message, code: e.code });
  }
});

/**
 * POST /api/admin/diagnose-user
 * Master-phrase-protected diagnóstico + repair de cuenta atorada.
 *
 * Body: {
 *   phrase: "CASTORES",
 *   email: "ventas@castoresmty.com",
 *   action?: "diagnose" | "set-temp-password" | "send-reset" | "reactivate" | "relink-clerk",
 *   newPassword?: string  // requerido solo cuando action="set-temp-password"
 * }
 *
 * Devuelve el estado de la cuenta en nuestra DB y en Clerk, junto con el
 * resultado de la acción de reparación si se pidió. Pensado para destrabar
 * usuarios desde un cliente HTTP / curl sin tener que tocar la DB
 * directamente ni el dashboard de Clerk.
 */
router.post("/admin/diagnose-user", async (req, res): Promise<void> => {
  const { phrase, email: rawEmail, action = "diagnose", newPassword } = req.body as {
    phrase?: string;
    email?: string;
    action?: string;
    newPassword?: string;
  };

  if (!phrase || !isMasterAdminKey(phrase)) {
    res.status(403).json({ error: "Frase inválida" });
    return;
  }
  if (!rawEmail) {
    res.status(400).json({ error: "Falta email" });
    return;
  }
  const email = rawEmail.trim().toLowerCase();

  const CLERK_SECRET = process.env["CLERK_SECRET_KEY"] ?? "";
  if (!CLERK_SECRET) {
    res.status(503).json({ error: "CLERK_SECRET_KEY no configurada en el servidor" });
    return;
  }

  async function clerk(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: any }> {
    const r = await fetch(`https://api.clerk.com/v1${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${CLERK_SECRET}`,
        "Content-Type": "application/json",
      },
    });
    const text = await r.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { ok: r.ok, status: r.status, body };
  }

  const { clerkId: explicitClerkId } = req.body as { clerkId?: string };

  const client = await pool.connect();
  try {
    // 1) DB lookup
    const dbResp = await client.query(
      'SELECT id, name, email, role, is_active, approval_status, clerk_id, created_at FROM users WHERE LOWER(email) = $1 LIMIT 1',
      [email]
    );
    const dbUser = dbResp.rows[0] ?? null;

    // 2) Clerk lookup. Si vino clerkId explícito, lookup directo por ID;
    // si no, buscar por email. También recuperamos por dbUser.clerk_id
    // si difiere para detectar el caso "DB tiene un clerk_id que ya no
    // existe / apunta a otro user".
    const clerkList = await clerk(`/users?email_address[]=${encodeURIComponent(email)}&limit=1`);
    const clerkArr = Array.isArray(clerkList.body) ? clerkList.body : (clerkList.body?.data ?? []);
    const clerkUser = Array.isArray(clerkArr) && clerkArr.length > 0 ? clerkArr[0] : null;

    // Sondeo extra: si la DB apunta a un clerk_id distinto, vamos a verlo
    const dbLinkedClerk =
      dbUser && dbUser.clerk_id && (!clerkUser || clerkUser.id !== dbUser.clerk_id)
        ? await clerk(`/users/${dbUser.clerk_id}`)
        : null;
    const explicitClerk = explicitClerkId ? await clerk(`/users/${explicitClerkId}`) : null;

    const diagnosis = {
      input: { email },
      db: dbUser
        ? {
            exists: true,
            id: dbUser.id,
            name: dbUser.name,
            role: dbUser.role,
            isActive: dbUser.is_active,
            approvalStatus: dbUser.approval_status,
            clerkId: dbUser.clerk_id,
            createdAt: dbUser.created_at,
          }
        : { exists: false },
      clerk: clerkUser
        ? {
            exists: true,
            id: clerkUser.id,
            primaryEmail: clerkUser.email_addresses?.find((e: any) => e.id === clerkUser.primary_email_address_id)?.email_address ?? null,
            hasPassword: !!clerkUser.password_enabled,
            banned: !!clerkUser.banned,
            locked: !!clerkUser.locked,
            createdAt: clerkUser.created_at,
            lastSignInAt: clerkUser.last_sign_in_at,
          }
        : { exists: false },
      dbLinkedClerk: dbLinkedClerk
        ? dbLinkedClerk.ok
          ? {
              exists: true,
              id: dbLinkedClerk.body.id,
              primaryEmail: dbLinkedClerk.body.email_addresses?.find((e: any) => e.id === dbLinkedClerk.body.primary_email_address_id)?.email_address ?? null,
              hasPassword: !!dbLinkedClerk.body.password_enabled,
              banned: !!dbLinkedClerk.body.banned,
              locked: !!dbLinkedClerk.body.locked,
            }
          : { exists: false, status: dbLinkedClerk.status }
        : null,
      explicitClerk: explicitClerk
        ? explicitClerk.ok
          ? {
              exists: true,
              id: explicitClerk.body.id,
              primaryEmail: explicitClerk.body.email_addresses?.find((e: any) => e.id === explicitClerk.body.primary_email_address_id)?.email_address ?? null,
              hasPassword: !!explicitClerk.body.password_enabled,
              emails: (explicitClerk.body.email_addresses ?? []).map((e: any) => e.email_address),
            }
          : { exists: false, status: explicitClerk.status }
        : null,
      problems: [] as string[],
    };

    if (!dbUser && !clerkUser) diagnosis.problems.push("Usuario no existe en DB ni en Clerk");
    if (dbUser && !clerkUser) diagnosis.problems.push("Existe en DB pero no en Clerk — no podrá iniciar sesión hasta crearse en Clerk");
    if (!dbUser && clerkUser) diagnosis.problems.push("Existe en Clerk pero no en nuestra DB — login fallará en el step de validar usuario activo");
    if (dbUser && clerkUser && (!dbUser.clerk_id || dbUser.clerk_id !== clerkUser.id)) {
      diagnosis.problems.push(`clerk_id en DB (${dbUser.clerk_id ?? "null"}) no coincide con Clerk (${clerkUser.id})`);
    }
    if (dbUser && !dbUser.is_active) diagnosis.problems.push("Cuenta marcada inactiva en DB");
    if (clerkUser && clerkUser.banned) diagnosis.problems.push("Cuenta baneada en Clerk");
    if (clerkUser && clerkUser.locked) diagnosis.problems.push("Cuenta bloqueada en Clerk (probablemente por intentos fallidos)");
    if (clerkUser && !clerkUser.password_enabled) diagnosis.problems.push("Clerk indica que el usuario no tiene contraseña configurada");

    // 3) Acción de reparación opcional
    const repair: Record<string, unknown> = {};

    if (action === "diagnose") {
      // nada más
    } else if (action === "reactivate") {
      if (!dbUser) {
        repair.error = "No hay registro en DB para reactivar";
      } else {
        await client.query('UPDATE users SET is_active = true, approval_status = $1 WHERE id = $2', ["approved", dbUser.id]);
        repair.dbReactivated = true;
      }
      if (clerkUser?.locked) {
        const r = await clerk(`/users/${clerkUser.id}/unlock`, { method: "POST" });
        repair.clerkUnlocked = r.ok;
        if (!r.ok) repair.clerkUnlockError = r.body;
      }
    } else if (action === "make-superadmin") {
      // El "usuario número 1": rol admin + isActive=true + approved.
      // Pensado como llave de emergencia. Se invoca con la frase maestra
      // y restaura/garantiza acceso de admin para un email dado, sin
      // importar en qué estado quedó (rechazado, demoteado, inactivo).
      // Si ese email no existe en DB todavía, lo CREA siempre que exista
      // el Clerk user correspondiente (linkea por clerk_id).
      if (dbUser) {
        await client.query(
          "UPDATE users SET is_active = true, approval_status = 'approved', role = 'admin', updated_at = NOW() WHERE id = $1",
          [dbUser.id]
        );
        // Si el clerk_id de DB difiere del Clerk user real con ese email
        // como primario, relinkamos hacia el primario (que es el dueño
        // canónico del email).
        const realClerk = dbLinkedClerk?.ok ? dbLinkedClerk.body : (clerkUser?.email_addresses?.find((e: any) => e.id === clerkUser.primary_email_address_id)?.email_address?.toLowerCase() === email ? clerkUser : null);
        if (realClerk?.id && realClerk.id !== dbUser.clerk_id) {
          await client.query("UPDATE users SET clerk_id = $1 WHERE id = $2", [realClerk.id, dbUser.id]);
          repair.relinked = realClerk.id;
        }
        repair.dbPromoted = true;
        repair.userId = dbUser.id;
      } else {
        // No existe en DB. Si hay un Clerk user con ese email como primary,
        // creamos la fila local promovida a admin.
        const candidate = dbLinkedClerk?.ok ? dbLinkedClerk.body
          : (clerkUser && (clerkUser.email_addresses ?? []).find((e: any) => e.id === clerkUser.primary_email_address_id)?.email_address?.toLowerCase() === email ? clerkUser : null);
        if (!candidate) {
          repair.error = "No hay Clerk user con ese email como primario para crear la cuenta";
        } else {
          const fullName = [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") || email.split("@")[0];
          const ins = await client.query(
            `INSERT INTO users (clerk_id, name, email, role, is_active, approval_status, terms_accepted_at, terms_version, created_at, updated_at)
             VALUES ($1, $2, $3, 'admin', true, 'approved', NOW(), '1.0', NOW(), NOW())
             RETURNING id`,
            [candidate.id, fullName, email]
          );
          repair.dbCreated = true;
          repair.userId = ins.rows[0]?.id;
        }
      }

      // Limpieza preventiva: si el email aparece como secundario en otras
      // cuentas Clerk, lo quitamos para evitar colisiones futuras. Nunca
      // tocamos el primario de otro user.
      const list = await clerk(`/users?email_address[]=${encodeURIComponent(email)}&limit=20`);
      const arr = Array.isArray(list.body) ? list.body : (list.body?.data ?? []);
      const cleaned: any[] = [];
      if (Array.isArray(arr)) {
        for (const u of arr) {
          const isPrimary = (u.email_addresses ?? []).some(
            (e: any) => e.id === u.primary_email_address_id && (e.email_address ?? "").toLowerCase() === email
          );
          if (isPrimary) continue;
          const sec = (u.email_addresses ?? []).find(
            (e: any) => (e.email_address ?? "").toLowerCase() === email && e.id !== u.primary_email_address_id
          );
          if (sec) {
            const del = await clerk(`/email_addresses/${sec.id}`, { method: "DELETE" });
            cleaned.push({ clerkId: u.id, removedSecondary: sec.id, ok: del.ok });
          }
        }
      }
      repair.clerkSecondariesCleaned = cleaned;
    } else if (action === "relink-clerk") {
      if (!dbUser || !clerkUser) {
        repair.error = "Hace falta que el usuario exista en ambos lados para relinkearlo";
      } else {
        await client.query('UPDATE users SET clerk_id = $1 WHERE id = $2', [clerkUser.id, dbUser.id]);
        repair.clerkIdLinked = clerkUser.id;
      }
    } else if (action === "set-temp-password") {
      // Cuando el lookup por email devuelve un Clerk user distinto al que
      // está linkeado en la DB (caso típico de email duplicado en otra
      // cuenta), preferimos el clerk_id que vive en NUESTRA DB porque
      // ese es el dueño canónico del registro local.
      const targetClerkId = explicitClerkId
        ?? (dbUser?.clerk_id && dbLinkedClerk?.ok ? dbUser.clerk_id : clerkUser?.id);
      if (!targetClerkId) {
        repair.error = "No hay un Clerk user al que setearle contraseña";
      } else if (!newPassword || newPassword.length < 8) {
        repair.error = "newPassword es requerido (mínimo 8 caracteres)";
      } else {
        const r = await clerk(`/users/${targetClerkId}`, {
          method: "PATCH",
          body: JSON.stringify({
            password: newPassword,
            skip_password_checks: false,
            sign_out_of_other_sessions: true,
          }),
        });
        repair.clerkPasswordReset = r.ok;
        repair.targetClerkId = targetClerkId;
        if (!r.ok) repair.clerkPasswordResetError = r.body;
      }
    } else if (action === "remove-secondary-email") {
      // Body: { phrase, email: emailDelDueñoQueQueremosLiberar, clerkId: cuentaDeDondeQuitarEmail }
      const stripFromClerkId = explicitClerkId;
      if (!stripFromClerkId) {
        repair.error = "Falta clerkId (la cuenta de la que quitar el email)";
      } else {
        const owner = await clerk(`/users/${stripFromClerkId}`);
        if (!owner.ok) {
          repair.error = `No se encontró el Clerk user ${stripFromClerkId}`;
        } else {
          const matchingEmail = (owner.body.email_addresses ?? []).find(
            (e: any) => (e.email_address ?? "").toLowerCase() === email
          );
          if (!matchingEmail) {
            repair.error = `${email} no está asociado a ${stripFromClerkId}`;
          } else if (matchingEmail.id === owner.body.primary_email_address_id) {
            repair.error = `${email} es el email PRIMARIO de ${stripFromClerkId}; no lo quito automáticamente`;
          } else {
            const del = await clerk(`/email_addresses/${matchingEmail.id}`, { method: "DELETE" });
            repair.removedEmailId = matchingEmail.id;
            repair.removedFromClerkId = stripFromClerkId;
            repair.removedOk = del.ok;
            if (!del.ok) repair.removedError = del.body;
          }
        }
      }
    } else if (action === "send-reset") {
      // Reusa el flujo /auth/forgot-password externamente — aquí solo
      // confirmamos que la cuenta existe y está apta para que llegue.
      if (!dbUser || !dbUser.is_active) {
        repair.error = "El usuario no está activo en DB; el correo de reset no se enviaría";
      } else {
        repair.note = "Llama a POST /api/auth/forgot-password con este email para que llegue el correo.";
      }
    } else if (action === "free-up-email") {
      // Limpia TODO lo que esté reteniendo este email para que un sign-up
      // nuevo funcione: borra (o anonimiza si hay FK constraint) la fila
      // local, borra el Clerk user si su primary email coincide, y quita
      // el email de cualquier otra cuenta Clerk donde aparezca como
      // secundario. Es el "after action review" automático cuando el
      // admin borró un usuario y la app sigue diciendo "ya está
      // registrado".
      const steps: any = {};

      // 1) DB: hard delete; si FK falla, anonimiza
      if (dbUser) {
        try {
          await client.query('DELETE FROM users WHERE id = $1', [dbUser.id]);
          steps.dbHardDeleted = true;
        } catch (e: any) {
          if (e.code === "23503") {
            // FK constraint: anonimizar para liberar email + romper login
            const ts = Date.now();
            const anon = `deleted_${dbUser.id}_${ts}@deleted.local`;
            await client.query(
              "UPDATE users SET email = $1, is_active = false, approval_status = 'rejected', clerk_id = NULL, name = $2 WHERE id = $3",
              [anon, `[Eliminado] ${dbUser.name ?? "Usuario"}`, dbUser.id]
            );
            steps.dbAnonymized = true;
            steps.dbAnonymizedReason = "FK constraint impedía hard-delete; se anonimizó para preservar bitácoras/materiales históricos";
          } else {
            steps.dbDeleteError = e.message ?? String(e);
          }
        }
      } else {
        steps.dbNoOp = "No había fila local con ese email";
      }

      // 2) Clerk: borrar todos los users que tengan este email como PRIMARY,
      //    y quitar el email de los que lo tengan como secundario.
      const list = await clerk(`/users?email_address[]=${encodeURIComponent(email)}&limit=20`);
      const arr = Array.isArray(list.body) ? list.body : (list.body?.data ?? []);
      const clerkResults: any[] = [];
      if (Array.isArray(arr)) {
        for (const u of arr) {
          const primary = (u.email_addresses ?? []).find((e: any) => e.id === u.primary_email_address_id);
          const isPrimary = primary && (primary.email_address ?? "").toLowerCase() === email;
          const secondary = (u.email_addresses ?? []).find(
            (e: any) => (e.email_address ?? "").toLowerCase() === email && e.id !== u.primary_email_address_id
          );

          if (isPrimary) {
            const del = await clerk(`/users/${u.id}`, { method: "DELETE" });
            clerkResults.push({ clerkId: u.id, action: "deleted_user_primary", ok: del.ok });
          } else if (secondary) {
            const del = await clerk(`/email_addresses/${secondary.id}`, { method: "DELETE" });
            clerkResults.push({ clerkId: u.id, action: "removed_secondary_email", emailId: secondary.id, ok: del.ok });
          }
        }
      }
      steps.clerkResults = clerkResults;

      repair.steps = steps;
      repair.summary = "Email liberado; ya se puede usar para registrar una cuenta nueva.";
    } else {
      repair.error = `Acción no reconocida: ${action}`;
    }

    res.json({ ok: true, diagnosis, action, repair });
  } catch (err: unknown) {
    const e = err as { message?: string };
    res.status(500).json({ error: e.message ?? "diagnose-user failed" });
  } finally {
    client.release();
  }
});

export default router;
