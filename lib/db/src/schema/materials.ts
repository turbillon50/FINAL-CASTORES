import { pgTable, text, serial, timestamp, integer, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const materialsTable = pgTable("materials", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  requestedById: integer("requested_by_id").notNull(),
  // noteId asocia este renglón a una "nota de mostrador" cuando el material
  // se capturó como parte de un grupo (5 ton de acero + 2 ton de cemento +
  // varilla en una sola nota). Es nullable porque los materiales viejos —
  // creados antes del modelo de notas — siguen siendo registros sueltos.
  noteId: integer("note_id"),
  name: text("name").notNull(),
  description: text("description"),
  unit: text("unit").notNull(),
  // Cantidades en doublePrecision (float64): da ~15 dígitos exactos, más
  // que suficiente para cantidades reales sin redondeo de centavos.
  quantityRequested: doublePrecision("quantity_requested").notNull(),
  quantityApproved: doublePrecision("quantity_approved"),
  quantityUsed: doublePrecision("quantity_used"),
  costPerUnit: doublePrecision("cost_per_unit"),
  totalCost: doublePrecision("total_cost"),
  status: text("status").notNull().default("pending"),
  approvedById: integer("approved_by_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMaterialSchema = createInsertSchema(materialsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaterial = z.infer<typeof insertMaterialSchema>;
export type Material = typeof materialsTable.$inferSelect;
