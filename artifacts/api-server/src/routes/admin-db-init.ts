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

const INIT_SQL = `-- ============================================================
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
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

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
  "name" text NOT NULL,
  "description" text,
  "unit" text NOT NULL,
  "quantity_requested" real NOT NULL,
  "quantity_approved" real,
  "quantity_used" real,
  "cost_per_unit" real,
  "total_cost" real,
  "status" text NOT NULL DEFAULT 'pending',
  "approved_by_id" integer,
  "approved_at" timestamptz,
  "notes" text,
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
  ON "push_subscriptions" ("endpoint");`;

// Seed: matriz de permisos por defecto para los 5 roles. Idempotente.
const SEED_ROLE_PERMISSIONS_SQL = `
INSERT INTO role_permissions (role, permissions) VALUES
  ('admin', '{"dashboardFull":true,"projectsViewAll":true,"projectsCreateEdit":true,"bitacoraView":true,"bitacoraCreate":true,"budgetViewAmounts":true,"materialsApprove":true,"materialsRequest":true,"materialsSupply":true,"workersView":true,"workersManage":true,"documentsLegalView":true,"documentsLegalManage":true,"adminPanelAccess":true}'::jsonb),
  ('supervisor', '{"dashboardFull":true,"projectsViewAll":true,"projectsCreateEdit":false,"bitacoraView":true,"bitacoraCreate":true,"budgetViewAmounts":true,"materialsApprove":false,"materialsRequest":true,"materialsSupply":false,"workersView":true,"workersManage":false,"documentsLegalView":true,"documentsLegalManage":false,"adminPanelAccess":false}'::jsonb),
  ('client', '{"dashboardFull":false,"projectsViewAll":false,"projectsCreateEdit":false,"bitacoraView":true,"bitacoraCreate":false,"budgetViewAmounts":true,"materialsApprove":false,"materialsRequest":false,"materialsSupply":false,"workersView":false,"workersManage":false,"documentsLegalView":true,"documentsLegalManage":false,"adminPanelAccess":false}'::jsonb),
  ('worker', '{"dashboardFull":false,"projectsViewAll":false,"projectsCreateEdit":false,"bitacoraView":true,"bitacoraCreate":true,"budgetViewAmounts":false,"materialsApprove":false,"materialsRequest":false,"materialsSupply":false,"workersView":false,"workersManage":false,"documentsLegalView":false,"documentsLegalManage":false,"adminPanelAccess":false}'::jsonb),
  ('proveedor', '{"dashboardFull":false,"projectsViewAll":false,"projectsCreateEdit":false,"bitacoraView":false,"bitacoraCreate":false,"budgetViewAmounts":false,"materialsApprove":false,"materialsRequest":false,"materialsSupply":true,"workersView":false,"workersManage":false,"documentsLegalView":true,"documentsLegalManage":false,"adminPanelAccess":false}'::jsonb)
ON CONFLICT (role) DO NOTHING;
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

export default router;
