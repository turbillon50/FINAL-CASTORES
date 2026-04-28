import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";
import {
  MarkNotificationReadParams,
  ListNotificationsQueryParams,
} from "@workspace/api-zod";
import { getRequestUser } from "../lib/getRequestUser";
import { resolveAuthedUser } from "../lib/authContext";

const router: IRouter = Router();

router.get("/notifications/unread-count", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  const userId = user.id;
  const all = await db.select({ isRead: notificationsTable.isRead })
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId));
  const unread = all.filter((n) => !n.isRead).length;
  res.json({ unread });
});

router.get("/notifications", async (req, res): Promise<void> => {
  const parsed = ListNotificationsQueryParams.safeParse(req.query);
  const user = await resolveAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  const userId = user.id;

  let notifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(notificationsTable.createdAt);

  if (parsed.success && parsed.data.unread === true) {
    notifications = notifications.filter((n) => !n.isRead);
  }

  res.json(notifications);
});

router.patch("/notifications/read-all", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  const userId = user.id;
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));

  res.json({ success: true });
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Ownership check — prevent IDOR. Only the recipient may mark their own
  // notification as read.
  const user = await resolveAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  const userId = user.id;

  const [notification] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, params.data.id), eq(notificationsTable.userId, userId)))
    .returning();

  if (!notification) {
    res.status(404).json({ error: "Notificación no encontrada" });
    return;
  }

  res.json(notification);
});

// POST /notifications/send — admin only, broadcast by role or specific user
router.post("/notifications/send", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Acceso denegado" }); return; }

  const { title, message, targetType, targetRole, targetUserId } = req.body as {
    title?: string; message?: string;
    targetType?: "all" | "role" | "user";
    targetRole?: string; targetUserId?: number;
  };

  if (!title || !message || !targetType) {
    res.status(400).json({ error: "Título, mensaje y tipo de destino son requeridos" });
    return;
  }

  let targetUsers: { id: number }[] = [];

  if (targetType === "all") {
    targetUsers = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.isActive, true));
  } else if (targetType === "role" && targetRole) {
    targetUsers = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.role, targetRole), eq(usersTable.isActive, true)));
  } else if (targetType === "user" && targetUserId) {
    targetUsers = [{ id: targetUserId }];
  }

  if (targetUsers.length === 0) {
    res.json({ sent: 0 });
    return;
  }

  await db.insert(notificationsTable).values(
    targetUsers.map((u) => ({
      userId: u.id,
      title,
      message,
      type: "general" as const,
      isRead: false,
    }))
  );

  res.json({ sent: targetUsers.length });
});

export default router;
