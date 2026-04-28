import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const rolePermissionsTable = pgTable("role_permissions", {
  role: text("role").primaryKey(),
  permissions: jsonb("permissions").notNull().$type<Record<string, boolean>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RolePermissions = typeof rolePermissionsTable.$inferSelect;

export const PERMISSION_KEYS = [
  "dashboardFull",
  "projectsViewAll",
  "projectsCreateEdit",
  "bitacoraView",
  "bitacoraCreate",
  "budgetViewAmounts",
  "materialsApprove",
  "materialsRequest",
  "materialsSupply",
  "workersView",
  "workersManage",
  "documentsLegalView",
  "documentsLegalManage",
  "adminPanelAccess",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string; group: string }> = {
  dashboardFull: { label: "Dashboard completo", description: "Ver el centro de mando con todas las métricas", group: "General" },
  projectsViewAll: { label: "Ver TODAS las obras", description: "Ver listado completo (si no, solo las asignadas)", group: "Obras" },
  projectsCreateEdit: { label: "Crear/editar obras", description: "Crear nuevas obras y modificar existentes", group: "Obras" },
  bitacoraView: { label: "Ver bitácora", description: "Consultar registro diario de actividades", group: "Bitácora" },
  bitacoraCreate: { label: "Crear entradas en bitácora", description: "Añadir notas, fotos, avances", group: "Bitácora" },
  budgetViewAmounts: { label: "Ver montos de presupuesto", description: "Ver dinero, costos y porcentajes ejercidos", group: "Finanzas" },
  materialsApprove: { label: "Aprobar materiales", description: "Autorizar solicitudes de compra", group: "Materiales" },
  materialsRequest: { label: "Solicitar materiales", description: "Crear nuevas solicitudes", group: "Materiales" },
  materialsSupply: { label: "Surtir materiales", description: "Marcar entregas como completadas (proveedores)", group: "Materiales" },
  workersView: { label: "Ver trabajadores", description: "Consultar lista y datos básicos del personal", group: "Personal" },
  workersManage: { label: "Gestionar trabajadores", description: "Alta, baja, asignación de roles", group: "Personal" },
  documentsLegalView: { label: "Ver documentos legales", description: "Consultar contratos, permisos, licencias", group: "Documentos" },
  documentsLegalManage: { label: "Gestionar documentos legales", description: "Subir, reemplazar y eliminar documentos", group: "Documentos" },
  adminPanelAccess: { label: "Acceso al panel admin", description: "Entrar al panel administrativo de control", group: "Sistema" },
};

export const ROLE_DEFAULTS: Record<string, Record<PermissionKey, boolean>> = {
  admin: {
    dashboardFull: true, projectsViewAll: true, projectsCreateEdit: true,
    bitacoraView: true, bitacoraCreate: true, budgetViewAmounts: true,
    materialsApprove: true, materialsRequest: true, materialsSupply: true,
    workersView: true, workersManage: true,
    documentsLegalView: true, documentsLegalManage: true, adminPanelAccess: true,
  },
  supervisor: {
    dashboardFull: true, projectsViewAll: true, projectsCreateEdit: false,
    bitacoraView: true, bitacoraCreate: true, budgetViewAmounts: true,
    materialsApprove: false, materialsRequest: true, materialsSupply: false,
    workersView: true, workersManage: false,
    documentsLegalView: true, documentsLegalManage: false, adminPanelAccess: false,
  },
  client: {
    dashboardFull: false, projectsViewAll: false, projectsCreateEdit: false,
    bitacoraView: true, bitacoraCreate: false, budgetViewAmounts: true,
    materialsApprove: false, materialsRequest: false, materialsSupply: false,
    workersView: false, workersManage: false,
    documentsLegalView: true, documentsLegalManage: false, adminPanelAccess: false,
  },
  worker: {
    dashboardFull: false, projectsViewAll: false, projectsCreateEdit: false,
    bitacoraView: true, bitacoraCreate: true, budgetViewAmounts: false,
    materialsApprove: false, materialsRequest: false, materialsSupply: false,
    workersView: false, workersManage: false,
    documentsLegalView: false, documentsLegalManage: false, adminPanelAccess: false,
  },
  proveedor: {
    dashboardFull: false, projectsViewAll: false, projectsCreateEdit: false,
    bitacoraView: false, bitacoraCreate: false, budgetViewAmounts: false,
    materialsApprove: false, materialsRequest: false, materialsSupply: true,
    workersView: false, workersManage: false,
    documentsLegalView: true, documentsLegalManage: false, adminPanelAccess: false,
  },
};
