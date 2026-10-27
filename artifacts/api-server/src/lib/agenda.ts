import { randomUUID } from "node:crypto";

export const DEFAULT_AGENDA_TEMPLATE =
  "Hola {cliente}, te recordamos tu cita de {servicio} el {fecha} a las {hora}. ¿Nos confirmas tu asistencia? ¡Gracias!";
export const AGENDA_STATUSES = [
  "pendiente",
  "confirmada",
  "cancelada",
  "completada",
  "no_asistio",
] as const;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];
export class AgendaError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function normalizePhone(value: unknown): string {
  if (typeof value !== "string" || /[^\d\s()+.-]/.test(value))
    throw new AgendaError("Escribe un WhatsApp válido con lada.");
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10) digits = "52" + digits;
  if (!/^[1-9]\d{10,14}$/.test(digits))
    throw new AgendaError("Escribe un WhatsApp válido con lada.");
  return "+" + digits;
}
export function agendaLocalParts(
  date: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
export function localToUtc(date: string, time: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    throw new AgendaError("Completa una fecha y hora válidas.");
  // An explicit zone makes saved appointments independent of device/server TZ.
  const target = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(target)) throw new AgendaError("La fecha no es válida.");
  let result = new Date(target);
  try {
    for (let i = 0; i < 3; i++) {
      const local = agendaLocalParts(result, timeZone);
      const difference = target - Date.parse(`${local.date}T${local.time}:00Z`);
      if (!difference) break;
      result = new Date(result.getTime() + difference);
    }
    const roundtrip = agendaLocalParts(result, timeZone);
    if (roundtrip.date !== date || roundtrip.time !== time)
      throw new Error("Invalid local time");
  } catch {
    throw new AgendaError("La fecha, hora o zona horaria no es válida.");
  }
  return result;
}
export function appointmentInput(input: Record<string, unknown>) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const service = typeof input.service === "string" ? input.service.trim() : "";
  if (!name || name.length > 160 || service.length > 300)
    throw new AgendaError("Revisa el nombre y el motivo de la cita.");
  const timeZone =
    typeof input.timeZone === "string" ? input.timeZone : "America/Mexico_City";
  const startsAt = localToUtc(
    String(input.date || ""),
    String(input.time || ""),
    timeZone,
  );
  const status = input.status ?? "pendiente";
  if (!AGENDA_STATUSES.includes(status as AgendaStatus))
    throw new AgendaError("Estado de cita no válido.");
  if (typeof input.optIn !== "boolean")
    throw new AgendaError(
      "Indica si el cliente autorizó recordatorios por WhatsApp.",
    );
  return {
    name,
    phone: normalizePhone(input.phone),
    service,
    timeZone,
    startsAt,
    status: status as AgendaStatus,
    optIn: input.optIn,
  };
}
export function reminderSchedule(startsAt: Date, now = new Date()) {
  return [24, 2]
    .map((hours) => ({
      id: randomUUID(),
      hours,
      dueAt: new Date(startsAt.getTime() - hours * 3600000),
    }))
    .filter((r) => r.dueAt > now);
}
export function nextDeliveryStatus(current: string, incoming: string): string {
  const rank: Record<string, number> = {
    scheduled: 0,
    processing: 1,
    unknown: 1,
    queued: 2,
    sending: 2,
    sent: 3,
    failed: 4,
    undelivered: 4,
    delivered: 5,
    read: 6,
  };
  if (!(incoming in rank) || ["cancelled", "expired"].includes(current))
    return current;
  return (rank[incoming] ?? -1) > (rank[current] ?? -1) ? incoming : current;
}
export function replyAction(
  body: unknown,
): { action: "confirmada" | "cancelada"; code: string } | null {
  if (typeof body !== "string") return null;
  const match = /^(CONFIRMAR|CANCELAR)\s+([A-F0-9]{8})$/i.exec(body.trim());
  return match
    ? {
        action:
          match[1].toUpperCase() === "CONFIRMAR" ? "confirmada" : "cancelada",
        code: match[2].toUpperCase(),
      }
    : null;
}

export const AGENDA_SQL = `
CREATE TABLE IF NOT EXISTS agenda_appointments (
 id uuid PRIMARY KEY, owner_id integer NOT NULL REFERENCES users(id), name text NOT NULL,
 phone text NOT NULL, service text NOT NULL DEFAULT '', starts_at timestamptz NOT NULL,
 time_zone text NOT NULL DEFAULT 'America/Mexico_City',
 status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','confirmada','cancelada','completada','no_asistio')),
 opt_in boolean NOT NULL DEFAULT false, opt_in_at timestamptz, version integer NOT NULL DEFAULT 1,
 reply_code text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS agenda_appointments_owner_date ON agenda_appointments(owner_id, starts_at) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS agenda_settings (
 owner_id integer PRIMARY KEY REFERENCES users(id), template text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agenda_reminders (
 id uuid PRIMARY KEY, appointment_id uuid NOT NULL REFERENCES agenda_appointments(id), appointment_version integer NOT NULL,
 offset_hours integer NOT NULL, due_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'scheduled',
 attempts integer NOT NULL DEFAULT 0, claimed_at timestamptz, provider_sid text UNIQUE, error_code text,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(appointment_id, appointment_version, offset_hours)
);
CREATE INDEX IF NOT EXISTS agenda_reminders_due ON agenda_reminders(due_at) WHERE status = 'scheduled';
CREATE TABLE IF NOT EXISTS agenda_inbound (
 provider_sid text PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now()
);
`;
