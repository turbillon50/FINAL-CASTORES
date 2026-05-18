import { pgTable, serial, integer, text, timestamp, real, index } from "drizzle-orm/pg-core";

// Un check-in es una sesión abierta cuando el trabajador llega a obra y
// cerrada cuando se va. checkOutAt NULL = aún en obra. Guardamos las
// coordenadas y distancia calculada al centro de la obra para auditar
// las decisiones del geofence sin tener que recomputar después.
//
// status:
//   ok      → dentro del radio, todo bien
//   flagged → fuera del radio pero la obra está en modo tolerant; pasó pero
//             queda marcado para revisión humana
//   manual  → admin/supervisor lo capturó a mano (sin GPS válido)
export const CHECK_IN_STATUSES = ["ok", "flagged", "manual"] as const;
export type CheckInStatus = (typeof CHECK_IN_STATUSES)[number];

export const checkInsTable = pgTable(
  "check_ins",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    projectId: integer("project_id").notNull(),
    // Check-in (entrada)
    checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull().defaultNow(),
    checkInLatitude: real("check_in_latitude"),
    checkInLongitude: real("check_in_longitude"),
    checkInAccuracy: real("check_in_accuracy"), // metros, del GPS del teléfono
    checkInDistanceMeters: real("check_in_distance_meters"), // al centro de la obra
    checkInPhotoUrl: text("check_in_photo_url"), // selfie o foto del frente
    checkInStatus: text("check_in_status").notNull().default("ok").$type<CheckInStatus>(),
    checkInNotes: text("check_in_notes"),
    // Check-out (salida) — todos nullable hasta que el worker cierre la sesión
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    checkOutLatitude: real("check_out_latitude"),
    checkOutLongitude: real("check_out_longitude"),
    checkOutAccuracy: real("check_out_accuracy"),
    checkOutDistanceMeters: real("check_out_distance_meters"),
    checkOutPhotoUrl: text("check_out_photo_url"),
    checkOutStatus: text("check_out_status").$type<CheckInStatus>(),
    checkOutNotes: text("check_out_notes"),
    // Quién validó la salida: si el supervisor mostró QR y el worker lo escaneó,
    // guardamos el id del supervisor que generó el QR. NULL = self-checkout.
    checkOutValidatedBy: integer("check_out_validated_by"),
    // Minutos totales — recalculados en el server al cerrar. Persisten para
    // que el reporte y exportación CSV no tengan que recomputar.
    totalMinutes: integer("total_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    // Para el query "¿tiene check-in abierto?": busca por userId y check_out_at IS NULL
    byUserOpen: index("check_ins_user_open_idx").on(t.userId, t.checkOutAt),
    // Para el reporte por obra+fecha
    byProjectDate: index("check_ins_project_date_idx").on(t.projectId, t.checkInAt),
  }),
);

export type CheckIn = typeof checkInsTable.$inferSelect;
export type InsertCheckIn = typeof checkInsTable.$inferInsert;
