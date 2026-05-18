import { pgTable, text, serial, timestamp, integer, real, doublePrecision, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type ProjectMilestone = {
  id: string;
  name: string;
  dueDate?: string | null;
  completed?: boolean;
  notes?: string | null;
};

// Modos de geocerca para asistencia. `strict` bloquea el check-in fuera del
// radio; `tolerant` lo permite pero lo marca como `flagged` (queda visible
// en el reporte para revisión del admin); `off` no valida ubicación.
export const GEOFENCE_MODES = ["strict", "tolerant", "off"] as const;
export type GeofenceMode = (typeof GEOFENCE_MODES)[number];

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  clientId: integer("client_id"),
  supervisorId: integer("supervisor_id"),
  location: text("location"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  // Radio en metros para considerar al trabajador "dentro de obra".
  // Default 100 m: cubre frente de obra típico sin volverse permisivo.
  // El modo determina si fuera-del-radio bloquea o solo se marca.
  geofenceRadiusMeters: integer("geofence_radius_meters").notNull().default(100),
  geofenceMode: text("geofence_mode").notNull().default("strict").$type<GeofenceMode>(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  // Dinero en doublePrecision: ~15 dígitos exactos, alcanza para
  // presupuestos en MXN con centavos sin pérdida por redondeo
  // (el viejo `real` era float32 y empezaba a redondear arriba de
  // ~$10 millones, comiéndose centavos en obras grandes).
  budget: doublePrecision("budget"),
  spentAmount: doublePrecision("spent_amount").default(0),
  progressPercent: integer("progress_percent").notNull().default(0),
  status: text("status").notNull().default("active"),
  coverImageUrl: text("cover_image_url"),
  galleryImages: text("gallery_images").array().default([]),
  milestones: jsonb("milestones").$type<ProjectMilestone[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
