import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
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
    .orderBy(desc(notificationsTable.createdAt));

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

  // Asegura que el admin que mandó el aviso reciba siempre su propia copia,
  // aunque el broadcast haya sido a otro rol o a otro usuario. Así desde
  // /notificaciones puede ver lo que él mismo envió y confirmar que salió.
  // Antes, mandar a "rol cliente" creaba filas solo para clientes y el
  // admin no veía nada en su feed.
  //
  // Marcamos con un prefijo + un sufijo en el destino la copia que se le
  // entrega al propio admin para que pueda distinguir "yo lo envié" vs
  // "alguien me envió esto" sin necesidad de ampliar el esquema con un
  // senderId.
  const externalIds = targetUsers.map((u) => u.id).filter((id) => id !== user.id);
  const dedupedExternal = Array.from(new Set(externalIds));

  const destLabel = (() => {
    if (targetType === "all") return "todos";
    if (targetType === "role" && targetRole) return `rol "${targetRole}"`;
    if (targetType === "user" && targetUserId) return `usuario #${targetUserId}`;
    return "destinatarios";
  })();

  const rows: Array<{ userId: number; title: string; message: string; type: "general"; isRead: boolean }> = [
    // Filas de los destinatarios reales — el título y el mensaje van tal
    // cual, sin mencionar al emisor.
    ...dedupedExternal.map((id) => ({
      userId: id,
      title,
      message,
      type: "general" as const,
      isRead: false,
    })),
    // Copia del admin emisor — prefijo + nota de destino para que en su
    // feed quede claro que es algo que ÉL envió, no algo que recibió.
    {
      userId: user.id,
      title: `📤 Enviado: ${title}`,
      message: `${message}\n\n— Aviso enviado a ${destLabel}.`,
      type: "general" as const,
      isRead: true,
    },
  ];

  await db.insert(notificationsTable).values(rows);

  // El número que devolvemos al admin es el de destinatarios externos
  // (sin contar la copia de confirmación que se entrega a sí mismo).
  res.json({ sent: dedupedExternal.length });
});

export default router;
