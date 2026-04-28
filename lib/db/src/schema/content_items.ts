import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const CONTENT_TYPES = [
  "banner",
  "announcement",
  "image",
  "faq",
  "terms",
  "privacy",
  "install_ios",
  "install_android",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const contentItemsTable = pgTable("content_items", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("announcement"),
  title: text("title").notNull(),
  body: text("body"),
  imageUrl: text("image_url"),
  linkUrl: text("link_url"),
  targetRole: text("target_role"),
  category: text("category"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertContentItemSchema = createInsertSchema(contentItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContentItem = z.infer<typeof insertContentItemSchema>;
export type ContentItem = typeof contentItemsTable.$inferSelect;
