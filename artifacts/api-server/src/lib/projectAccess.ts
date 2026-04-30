import { eq, or, inArray } from "drizzle-orm";
import { db, projectsTable, projectAssignmentsTable } from "@workspace/db";
import { hasPermission } from "./permissions";

/**
 * Returns the list of project IDs a user can access.
 * - Users with projectsViewAll permission: null (no filter = all projects)
 * - client: projects where they are clientId OR explicitly assigned
 * - Others without projectsViewAll: only explicitly assigned projects
 */
export async function getAccessibleProjectIds(
  user: { id: number; role: string },
): Promise<number[] | null> {
  if (await hasPermission(user.role, "projectsViewAll")) return null;

  const assignments = await db
    .select({ projectId: projectAssignmentsTable.projectId })
    .from(projectAssignmentsTable)
    .where(eq(projectAssignmentsTable.userId, user.id));
  const assignedIds = assignments.map((a) => a.projectId);

  if (user.role === "client") {
    const owned = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.clientId, user.id));
    const ids = new Set<number>([...assignedIds, ...owned.map((p) => p.id)]);
    return Array.from(ids);
  }

  return assignedIds;
}

/**
 * Returns true if the user can access the given project.
 */
export async function canAccessProject(
  user: { id: number; role: string },
  projectId: number,
): Promise<boolean> {
  const ids = await getAccessibleProjectIds(user);
  if (ids === null) return true;
  return ids.includes(projectId);
}
