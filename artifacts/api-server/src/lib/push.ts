import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { logger } from "./logger";

// VAPID se configura una sola vez al cargarse el módulo. Si las env vars
// faltan dejamos el módulo en modo "disabled" — sendPushTo* se vuelven
// no-ops y solo emitimos un warning. Esto evita que el cold start de la
// función serverless se caiga si alguien olvidó setear las keys en Vercel.
const VAPID_PUBLIC = process.env["VAPID_PUBLIC_KEY"] ?? "";
const VAPID_PRIVATE = process.env["VAPID_PRIVATE_KEY"] ?? "";
const VAPID_SUBJECT = process.env["VAPID_SUBJECT"] ?? "mailto:soporte@castores.info";

let pushReady = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    pushReady = true;
  } catch (err) {
    logger.error({ err }, "push: setVapidDetails failed; push notifications disabled");
  }
} else {
  logger.warn("push: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set; push disabled");
}

export function getPushPublicKey(): string | null {
  return VAPID_PUBLIC || null;
}

export function isPushReady(): boolean {
  return pushReady;
}

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
};

/**
 * Envía un push a todas las suscripciones de un set de usuarios.
 * - 410 Gone / 404 Not Found → la suscripción caducó: la borramos.
 * - Otros errores se logean pero no se propagan (un push fallido nunca
 *   debe romper el flujo HTTP que lo originó).
 */
export async function sendPushToUsers(
  userIds: number[],
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (!pushReady || userIds.length === 0) return { sent: 0, pruned: 0 };

  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, userIds));

  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  const expiredIds: number[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          expiredIds.push(s.id);
        } else {
          logger.warn({ err, subId: s.id, status: err?.statusCode }, "push: send failed");
        }
      }
    }),
  );

  if (expiredIds.length > 0) {
    try {
      await db.delete(pushSubscriptionsTable).where(inArray(pushSubscriptionsTable.id, expiredIds));
    } catch (err) {
      logger.warn({ err }, "push: prune of expired subs failed");
    }
  }

  return { sent, pruned: expiredIds.length };
}
