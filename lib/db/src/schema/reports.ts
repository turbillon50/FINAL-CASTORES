import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  generatedById: integer("generated_by_id").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  dateFrom: text("date_from"),
  dateTo: text("date_to"),
  summary: text("summary"),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, createdAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
