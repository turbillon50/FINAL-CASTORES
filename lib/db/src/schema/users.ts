import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const USER_ROLES = ["admin", "supervisor", "client", "worker", "proveedor"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: text("role").notNull().default("worker"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  company: text("company"),
  isActive: boolean("is_active").notNull().default(true),
  approvalStatus: text("approval_status").notNull().default("approved"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsVersion: text("terms_version"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
