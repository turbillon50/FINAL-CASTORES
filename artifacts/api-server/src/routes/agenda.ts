import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { resolveAuthedUser } from "../lib/authContext";
import {
  AgendaError,
  appointmentInput,
  DEFAULT_AGENDA_TEMPLATE,
  reminderSchedule,
} from "../lib/agenda";
import { whatsappReadiness } from "../lib/agendaWhatsApp";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use("/agenda", async (req, res, next) => {
  const user = await resolveAuthedUser(req);
  if (!user || user.role !== "admin") {
    res
      .status(403)
      .json({ error: "La agenda es privada para administradores." });
    return;
  }
  res.locals.agendaOwner = user.id;
  res.setHeader("Cache-Control", "no-store");
  next();
});
function endpoint(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof AgendaError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logger.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "agenda: request failed",
      );
      res
        .status(500)
        .json({
          error:
            "No se pudo guardar o consultar la agenda. Inténtalo de nuevo.",
        });
    }
  };
}
const SELECT_APPOINTMENTS = `SELECT a.*, COALESCE((SELECT json_agg(json_build_object('id',r.id,'hours',r.offset_hours,'dueAt',r.due_at,'status',r.status,'errorCode',r.error_code) ORDER BY r.due_at)
 FROM agenda_reminders r WHERE r.appointment_id=a.id AND r.appointment_version=a.version), '[]') AS reminders
 FROM agenda_appointments a`;
router.get(
  "/agenda",
  endpoint(async (_req, res) => {
    const [appointments, settings] = await Promise.all([
      pool.query(
        `${SELECT_APPOINTMENTS} WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY starts_at DESC`,
        [res.locals.agendaOwner],
      ),
      pool.query("SELECT template FROM agenda_settings WHERE owner_id=$1", [
        res.locals.agendaOwner,
      ]),
    ]);
    res.json({
      appointments: appointments.rows,
      template: settings.rows[0]?.template || DEFAULT_AGENDA_TEMPLATE,
      whatsapp: whatsappReadiness(),
    });
  }),
);
router.put(
  "/agenda/settings",
  endpoint(async (req, res) => {
    const template =
      typeof req.body?.template === "string" ? req.body.template.trim() : "";
    if (!template || template.length > 1500)
      throw new AgendaError("Escribe un mensaje de hasta 1500 caracteres.");
    await pool.query(
      "INSERT INTO agenda_settings(owner_id,template) VALUES ($1,$2) ON CONFLICT(owner_id) DO UPDATE SET template=$2, updated_at=now()",
      [res.locals.agendaOwner, template],
    );
    res.json({ template });
  }),
);
// Use one transaction for the appointment and its reminder plan. Editing a
// reminder already in flight returns a conflict, rather than sending stale data.
async function saveAppointment(req: Request, res: Response, editing: boolean) {
  const values = appointmentInput(req.body || {});
  if (!editing && values.startsAt <= new Date())
    throw new AgendaError("Selecciona una fecha y hora futuras.");
  const id = editing ? String(req.params.id) : randomUUID();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AgendaError("Cita no válida.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let version = 1;
    if (editing) {
      const previous = await client.query(
        "SELECT * FROM agenda_appointments WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
        [id, res.locals.agendaOwner],
      );
      if (!previous.rows[0])
        throw new AgendaError("La cita ya no está disponible.", 404);
      if (req.body.version !== previous.rows[0].version)
        throw new AgendaError(
          "La cita cambió en otro dispositivo. Actualiza antes de guardar.",
          409,
        );
      const active = await client.query(
        "SELECT 1 FROM agenda_reminders WHERE appointment_id=$1 AND status='processing'",
        [id],
      );
      if (active.rowCount)
        throw new AgendaError(
          "Se está enviando un recordatorio. Espera unos segundos y vuelve a intentar.",
          409,
        );
      version = previous.rows[0].version + 1;
      await client.query(
        "UPDATE agenda_reminders SET status='cancelled',updated_at=now() WHERE appointment_id=$1 AND status='scheduled'",
        [id],
      );
      await client.query(
        `UPDATE agenda_appointments SET name=$3,phone=$4,service=$5,starts_at=$6,time_zone=$7,status=$8,opt_in=$9,opt_in_at=CASE WHEN $9 THEN COALESCE(opt_in_at,now()) ELSE NULL END,version=$10,updated_at=now() WHERE id=$1 AND owner_id=$2`,
        [
          id,
          res.locals.agendaOwner,
          values.name,
          values.phone,
          values.service,
          values.startsAt,
          values.timeZone,
          values.status,
          values.optIn,
          version,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO agenda_appointments(id,owner_id,name,phone,service,starts_at,time_zone,status,opt_in,opt_in_at,reply_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9 THEN now() ELSE NULL END,$10)`,
        [
          id,
          res.locals.agendaOwner,
          values.name,
          values.phone,
          values.service,
          values.startsAt,
          values.timeZone,
          values.status,
          values.optIn,
          randomBytes(4).toString("hex").toUpperCase(),
        ],
      );
    }
    if (values.optIn && ["pendiente", "confirmada"].includes(values.status)) {
      for (const r of reminderSchedule(values.startsAt)) {
        await client.query(
          "INSERT INTO agenda_reminders(id,appointment_id,appointment_version,offset_hours,due_at) VALUES($1,$2,$3,$4,$5)",
          [r.id, id, version, r.hours, r.dueAt],
        );
      }
    }
    await client.query("COMMIT");
    const saved = await pool.query(`${SELECT_APPOINTMENTS} WHERE a.id=$1`, [
      id,
    ]);
    res.status(editing ? 200 : 201).json(saved.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
router.post(
  "/agenda/appointments",
  endpoint((req, res) => saveAppointment(req, res, false)),
);
router.put(
  "/agenda/appointments/:id",
  endpoint((req, res) => saveAppointment(req, res, true)),
);
router.delete(
  "/agenda/appointments/:id",
  endpoint(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id,version FROM agenda_appointments WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
        [req.params.id, res.locals.agendaOwner],
      );
      if (!existing.rows[0])
        throw new AgendaError("La cita ya no está disponible.", 404);
      if (req.body?.version !== existing.rows[0].version)
        throw new AgendaError(
          "La cita cambió. Actualiza antes de eliminarla.",
          409,
        );
      const active = await client.query(
        "SELECT 1 FROM agenda_reminders WHERE appointment_id=$1 AND status='processing'",
        [req.params.id],
      );
      if (active.rowCount)
        throw new AgendaError(
          "Hay un recordatorio en proceso. Inténtalo en unos segundos.",
          409,
        );
      await client.query(
        "UPDATE agenda_appointments SET deleted_at=now(),updated_at=now(),status='cancelada' WHERE id=$1",
        [req.params.id],
      );
      await client.query(
        "UPDATE agenda_reminders SET status='cancelled',updated_at=now() WHERE appointment_id=$1 AND status='scheduled'",
        [req.params.id],
      );
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
export default router;
