import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

// Tokens efímeros que el supervisor muestra como QR para que los workers
// validen check-out. Cada token vive ~2 minutos y se invalida en cuanto
// alguien lo redime. Sirve para garantizar que el worker estuvo
// físicamente frente al supervisor al cerrar su jornada (anti-fraude
// liviano: si compartiera el código por WhatsApp ya habría caducado).
//
// purpose: por ahora solo 'checkout', pero dejamos la columna por si
// más adelante usamos QR también para validar entrada en obras grandes.
export const QR_TOKEN_PURPOSES = ["checkout"] as const;
export type QrTokenPurpose = (typeof QR_TOKEN_PURPOSES)[number];

export const checkInQrTokensTable = pgTable(
  "check_in_qr_tokens",
  {
    id: serial("id").primaryKey(),
    token: text("token").notNull().unique(), // random 32 bytes hex
    projectId: integer("project_id").notNull(),
    issuedBy: integer("issued_by").notNull(), // supervisor que generó el QR
    purpose: text("purpose").notNull().default("checkout").$type<QrTokenPurpose>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedBy: integer("redeemed_by"), // worker que escaneó
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byProject: index("qr_tokens_project_idx").on(t.projectId),
    byExpiry: index("qr_tokens_expiry_idx").on(t.expiresAt),
  }),
);

export type CheckInQrToken = typeof checkInQrTokensTable.$inferSelect;
