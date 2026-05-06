import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { resolveAuthedUser } from "../lib/authContext";
import { getPushPublicKey, isPushReady } from "../lib/push";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/push/public-key", (_req, res): void => {
  const key = getPushPublicKey();
  if (!key) {
    res.status(503).json({ error: "Push no configurado" });
    return;
  }
  res.json({ publicKey: key, ready: isPushReady() });
});

router.post("/push/subscribe", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const { endpoint, keys, userAgent } = req.body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    userAgent?: string;
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "Suscripción incompleta" });
    return;
  }

  try {
    // Upsert por endpoint: si el mismo navegador re-suscribe (renovación o
    // cambio de usuario en el mismo dispositivo) reemplazamos la fila.
    await db
      .insert(pushSubscriptionsTable)
      .values({
        userId: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent ?? (req.headers["user-agent"] as string | undefined) ?? null,
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          userId: user.id,
          p256dh: keys.p256dh,
          auth: keys.auth,
          userAgent: userAgent ?? (req.headers["user-agent"] as string | undefined) ?? null,
          lastUsedAt: new Date(),
        },
      });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "push/subscribe failed");
    res.status(500).json({ error: "No se pudo guardar la suscripción" });
  }
});

router.post("/push/unsubscribe", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) {
    res.status(400).json({ error: "Endpoint requerido" });
    return;
  }
  try {
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.userId, user.id),
          eq(pushSubscriptionsTable.endpoint, endpoint),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "push/unsubscribe failed");
    res.status(500).json({ error: "No se pudo borrar la suscripción" });
  }
});

router.get("/push/status", async (req, res): Promise<void> => {
  const user = await resolveAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const subs = await db
    .select({ id: pushSubscriptionsTable.id, userAgent: pushSubscriptionsTable.userAgent, createdAt: pushSubscriptionsTable.createdAt })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, user.id));
  res.json({ subscriptions: subs });
});

export default router;
