import { Router, type IRouter } from "express";
import { eq, and, asc } from "drizzle-orm";
import { db, contentItemsTable } from "@workspace/db";
import { getRequestUser } from "../lib/getRequestUser";

const router: IRouter = Router();

// GET /content
router.get("/content", async (req, res): Promise<void> => {
  const { type, role } = req.query as { type?: string; role?: string };

  let query = db.select().from(contentItemsTable)
    .where(eq(contentItemsTable.isActive, true))
    .orderBy(asc(contentItemsTable.sortOrder), asc(contentItemsTable.createdAt));

  const items = await query;

  let filtered = items;
  if (type) filtered = filtered.filter((i) => i.type === type);
  if (role) filtered = filtered.filter((i) => !i.targetRole || i.targetRole === role);

  res.json(filtered);
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
