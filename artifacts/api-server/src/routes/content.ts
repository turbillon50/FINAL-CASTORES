import { Router, type IRouter } from "express";
import { eq, and, asc, ne } from "drizzle-orm";
import { db, contentItemsTable, usersTable, notificationsTable } from "@workspace/db";
import { getRequestUser } from "../lib/getRequestUser";
import { logger } from "../lib/logger";
import { sendPushToUsers } from "../lib/push";

const router: IRouter = Router();

// GET /content
router.get("/content", async (req, res): Promise<void> => {
  const { type, role } = req.query as { type?: string; role?: string };
  try {
    const items = await db.select().from(contentItemsTable)
      .where(eq(contentItemsTable.isActive, true))
      .orderBy(asc(contentItemsTable.sortOrder), asc(contentItemsTable.createdAt));

    let filtered = items;
    if (type) filtered = filtered.filter((i) => i.type === type);
    if (role) filtered = filtered.filter((i) => !i.targetRole || i.targetRole === role);

    res.json(filtered);
  } catch {
    // Degrade gracefully: public content is optional for app bootstrap.
    // Returning [] prevents white-screen/500 loops on the frontend.
    res.json([]);
  }
});

// GET /content/all — admin only, includes inactive
router.get("/content/all", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Acceso denegado" }); return; }

  const items = await db.select().from(contentItemsTable)
    .orderBy(asc(contentItemsTable.sortOrder), asc(contentItemsTable.createdAt));
  res.json(items);
});

// POST /content — admin only
router.post("/content", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Acceso denegado" }); return; }

  const { type, title, body, imageUrl, linkUrl, targetRole, category, sortOrder } = req.body as {
    type?: string; title?: string; body?: string;
    imageUrl?: string; linkUrl?: string; targetRole?: string; category?: string; sortOrder?: number;
  };

  if (!title || !type) { res.status(400).json({ error: "Título y tipo son requeridos" }); return; }

  const validTypes = ["banner", "announcement", "image", "faq", "terms", "privacy", "install_ios", "install_android"];
  if (!validTypes.includes(type)) { res.status(400).json({ error: "Tipo inválido" }); return; }

  const [item] = await db.insert(contentItemsTable).values({
    type,
    title,
    body: body ?? null,
    imageUrl: imageUrl ?? null,
    linkUrl: linkUrl ?? null,
    targetRole: targetRole ?? null,
    category: category ?? null,
    sortOrder: sortOrder ?? 0,
    createdBy: user.id,
    isActive: true,
  }).returning();

  // Broadcast announcements as in-app notifications to every relevant user
  // so they actually appear in the bell/Notificaciones screen on every
  // device. Before this, /content insert only filled the dashboard banner
  // list; nothing landed in notificationsTable, so users on other phones
  // never saw the alert. Failure here is logged but does not fail the
  // request — the announcement record itself is the source of truth.
  if (type === "announcement") {
    try {
      const recipients = await db
        .select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable)
        .where(and(
          eq(usersTable.isActive, true),
          ne(usersTable.id, user.id),
        ));

      const targeted = targetRole
        ? recipients.filter((u) => u.role === targetRole)
        : recipients;

      if (targeted.length > 0) {
        await db.insert(notificationsTable).values(
          targeted.map((u) => ({
            userId: u.id,
            title: title.slice(0, 200),
            message: (body ?? "").slice(0, 1000) || title.slice(0, 200),
            type: category ? `announcement:${category}` : "announcement",
            relatedId: item.id,
            relatedType: "content",
          }))
        );

        // Disparo de Web Push al SO. No bloquea la creación del anuncio:
        // si push está mal configurado o algunas suscripciones expiraron,
        // simplemente se logea y la campanita in-app sigue siendo el
        // canal de respaldo.
        sendPushToUsers(
          targeted.map((u) => u.id),
          {
            title: title.slice(0, 100),
            body: (body ?? "").slice(0, 200),
            url: "/notificaciones",
            tag: `announcement-${item.id}`,
          },
        ).catch((err) => logger.warn({ err }, "push: announcement broadcast failed"));
      }
    } catch (err) {
      logger.error({ err, contentId: item.id }, "Failed to broadcast announcement notifications");
    }
  }

  res.status(201).json(item);
});

// PATCH /content/:id — admin only
router.patch("/content/:id", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Acceso denegado" }); return; }

  const id = Number(req.params.id);
  const { title, body, imageUrl, linkUrl, targetRole, category, isActive, sortOrder } = req.body as {
    title?: string; body?: string; imageUrl?: string;
    linkUrl?: string; targetRole?: string; category?: string; isActive?: boolean; sortOrder?: number;
  };

  const updateData: Record<string, unknown> = {};
  if (title !== undefined) updateData.title = title;
  if (body !== undefined) updateData.body = body;
  if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
  if (linkUrl !== undefined) updateData.linkUrl = linkUrl;
  if (targetRole !== undefined) updateData.targetRole = targetRole;
  if (category !== undefined) updateData.category = category;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

  const [item] = await db.update(contentItemsTable).set(updateData)
    .where(eq(contentItemsTable.id, id)).returning();

  if (!item) { res.status(404).json({ error: "No encontrado" }); return; }
  res.json(item);
});

// DELETE /content/:id — admin only
router.delete("/content/:id", async (req, res): Promise<void> => {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Acceso denegado" }); return; }

  const id = Number(req.params.id);
  await db.delete(contentItemsTable).where(eq(contentItemsTable.id, id));
  res.json({ success: true });
});

export default router;
