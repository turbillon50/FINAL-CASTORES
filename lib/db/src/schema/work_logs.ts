import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workLogsTable = pgTable("work_logs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  supervisorId: integer("supervisor_id").notNull(),
  logDate: text("log_date").notNull(),
  activity: text("activity").notNull(),
  observations: text("observations"),
  workersInvolved: text("workers_involved"),
  materialsUsed: text("materials_used"),
  photos: text("photos").array().default([]),
  supervisorSignature: text("supervisor_signature"),
  clientSignature: text("client_signature"),
  isSubmitted: boolean("is_submitted").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWorkLogSchema = createInsertSchema(workLogsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkLog = z.infer<typeof insertWorkLogSchema>;
export type WorkLog = typeof workLogsTable.$inferSelect;
