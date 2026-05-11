import { pgTable, text, serial, timestamp, integer, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Cabecera de una "nota de mostrador". El detalle (los renglones de
 * materiales) vive en materialsTable con noteId apuntando aquí. Una
 * nota agrupa varios conceptos capturados en un mismo evento (compra,
 * entrega, requisición) — p. ej. "5 ton de acero + 2 ton de cemento +
 * varilla" en una sola nota — para evitar tener un registro por línea
 * suelto, que era lo que volvía la pantalla inmanejable.
 *
 * El total se guarda calculado al momento de crear/editar para no
 * recomputarlo en cada lectura. Si los renglones se modifican después
 * el endpoint se encarga de mantener el total sincronizado.
 */
export const materialNotesTable = pgTable("material_notes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  createdById: integer("created_by_id").notNull(),
  // Cuándo se hizo la compra/entrega — distinto a createdAt (cuándo se
  // capturó en el sistema). El dueño puede registrar una nota con
  // fecha pasada.
  noteDate: text("note_date").notNull(),
  // Folio de la nota física (papel) si existe — útil para cruzar con
  // facturación. Opcional.
  folio: text("folio"),
  supplierName: text("supplier_name"),
  description: text("description"),
  totalAmount: doublePrecision("total_amount").notNull().default(0),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMaterialNoteSchema = createInsertSchema(materialNotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaterialNote = z.infer<typeof insertMaterialNoteSchema>;
export type MaterialNote = typeof materialNotesTable.$inferSelect;
