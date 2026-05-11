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

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  clientId: integer("client_id"),
  supervisorId: integer("supervisor_id"),
  location: text("location"),
  latitude: real("latitude"),
  longitude: real("longitude"),
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
