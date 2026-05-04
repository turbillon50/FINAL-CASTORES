import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";

// Una fila por (usuario × dispositivo). Endpoint es único globalmente.
// Si el navegador renueva la suscripción reemplazamos por upsert sobre endpoint.
export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => ({
    endpointUnique: uniqueIndex("push_subscriptions_endpoint_unique").on(t.endpoint),
  }),
);

export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptionsTable.$inferInsert;
