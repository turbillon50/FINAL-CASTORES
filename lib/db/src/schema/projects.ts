import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
  budget: real("budget"),
  spentAmount: real("spent_amount").default(0),
  progressPercent: integer("progress_percent").notNull().default(0),
  status: text("status").notNull().default("active"),
  coverImageUrl: text("cover_image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
