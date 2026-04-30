import { eq } from "drizzle-orm";
import { db, projectsTable, projectAssignmentsTable } from "@workspace/db";
import { hasPermission } from "./permissions";

/**
 * Returns the list of project IDs a user can access.
 * - Users with projectsViewAll permission: null (no filter = all projects)
 * - Others: explicitly assigned projects + any project where they are supervisorId or clientId
 */
export async function getAccessibleProjectIds(
  user: { id: number; role: string },
): Promise<number[] | null> {
  if (await hasPermission(user.role, "projectsViewAll")) return null;

  const [assignments, asSupervisor, asClient] = await Promise.all([
    db
      .select({ projectId: projectAssignmentsTable.projectId })
      .from(projectAssignmentsTable)
      .where(eq(projectAssignmentsTable.userId, user.id)),
    db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.supervisorId, user.id)),
    db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.clientId, user.id)),
  ]);

  const ids = new Set<number>([
    ...assignments.map((a) => a.projectId),
    ...asSupervisor.map((p) => p.id),
    ...asClient.map((p) => p.id),
  ]);
  return Array.from(ids);
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
