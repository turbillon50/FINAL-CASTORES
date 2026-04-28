import { pgTable, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const projectAssignmentsTable = pgTable(
  "project_assignments",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull(),
    userId: integer("user_id").notNull(),
    assignedBy: integer("assigned_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqAssignment: uniqueIndex("project_assignments_unique").on(t.projectId, t.userId),
  }),
);

export type ProjectAssignment = typeof projectAssignmentsTable.$inferSelect;
