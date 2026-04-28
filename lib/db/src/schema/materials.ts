import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const materialsTable = pgTable("materials", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  requestedById: integer("requested_by_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  unit: text("unit").notNull(),
  quantityRequested: real("quantity_requested").notNull(),
  quantityApproved: real("quantity_approved"),
  quantityUsed: real("quantity_used"),
  costPerUnit: real("cost_per_unit"),
  totalCost: real("total_cost"),
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
