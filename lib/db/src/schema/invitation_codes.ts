import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invitationCodesTable = pgTable("invitation_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  role: text("role").notNull(),
  label: text("label"),
  createdBy: integer("created_by").notNull(),
  usedBy: integer("used_by"),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInvitationCodeSchema = createInsertSchema(invitationCodesTable).omit({ id: true, createdAt: true });
export type InsertInvitationCode = z.infer<typeof insertInvitationCodeSchema>;
export type InvitationCode = typeof invitationCodesTable.$inferSelect;
