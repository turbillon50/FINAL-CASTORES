import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  uploadedById: integer("uploaded_by_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull().default("other"),
  fileUrl: text("file_url").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, createdAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
