import { validateRequest } from "twilio/lib/webhooks/webhooks.js";
import { timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { agendaLocalParts, nextDeliveryStatus, replyAction } from "./agenda";

const REQUIRED = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM",
  "TWILIO_WHATSAPP_CONTENT_SID",
  "AGENDA_PUBLIC_URL",
  "CRON_SECRET",
];
export function whatsappReadiness() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  return {
    enabled: process.env["AGENDA_WHATSAPP_ENABLED"] === "true",
    configured: missing.length === 0,
    missing,
  };
}
export function secureEqual(actual: string, expected: string): boolean {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validateWhatsAppSignature(
  originalUrl: string,
  signature: string,
  body: Record<string, string>,
): boolean {
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const origin = process.env["AGENDA_PUBLIC_URL"]?.replace(/\/$/, "");
  if (!token || !origin || !origin.startsWith("https://")) return false;
  return validateRequest(token, signature, origin + originalUrl, body);
}

// Atomic claim + persistent outbox. A network timeout is ambiguous (Twilio may
// already have accepted it), so it is never automatically retried.
type SendReminder = (options: {
  from: string;
  to: string;
  contentSid: string;
  contentVariables: string;
  statusCallback: string;
}) => Promise<{ sid: string; status: string }>;
export async function runAgendaReminders(send?: SendReminder) {
  // Release interrupted claims even while automatic sending is disabled.
  await pool.query("UPDATE agenda_reminders SET status='unknown',error_code='INTERRUPTED',updated_at=now() WHERE status='processing' AND claimed_at < now()-interval '10 minutes'");
  const readiness = whatsappReadiness();
  if (!readiness.enabled || !readiness.configured)
    return { skipped: true, sent: 0, reason: "not_configured" };
  const lock = await pool.connect();
  const acquired = await lock.query(
    "SELECT pg_try_advisory_lock(740271) AS acquired",
  );
  if (!acquired.rows[0].acquired) {
    lock.release();
    return { skipped: true, sent: 0, reason: "already_running" };
  }
  let sent = 0;
  const started = Date.now();
  const sendMessage: SendReminder =
    send ||
    (async (options) => {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env["TWILIO_ACCOUNT_SID"]}/Messages.json`,
        {
          method: "POST",
          signal: AbortSignal.timeout(8000),
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(
                `${process.env["TWILIO_ACCOUNT_SID"]}:${process.env["TWILIO_AUTH_TOKEN"]}`,
              ).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            From: options.from,
            To: options.to,
            ContentSid: options.contentSid,
            ContentVariables: options.contentVariables,
            StatusCallback: options.statusCallback,
          }),
        },
      );
      const result = (await response.json()) as {
        sid?: string;
        status?: string;
        code?: number;
      };
      if (!response.ok)
        throw Object.assign(new Error("WhatsApp rejected the message"), {
          status: response.status,
          code: result.code,
        });
      if (!result.sid || !result.status)
        throw new Error("WhatsApp response incomplete");
      return { sid: result.sid, status: result.status };
    });
  try {
    await lock.query(
      "UPDATE agenda_reminders SET status='unknown',error_code='INTERRUPTED',updated_at=now() WHERE status='processing' AND claimed_at < now()-interval '10 minutes'",
    );
    await lock.query(
      `UPDATE agenda_reminders r SET status='expired',updated_at=now() FROM agenda_appointments a WHERE r.appointment_id=a.id AND r.status='scheduled' AND (a.starts_at<=now() OR r.due_at<now()-interval '30 minutes')`,
    );
    while (sent < 10 && Date.now() - started < 35000) {
      await lock.query("BEGIN");
      // The appointment lock is shared with edits/deletion and prevents a claim
      // racing a cancellation. Do not hold the DB transaction during HTTP.
      const claim =
        await lock.query(`SELECT r.id AS reminder_id,a.* FROM agenda_reminders r JOIN agenda_appointments a ON a.id=r.appointment_id
        WHERE r.status='scheduled' AND r.due_at<=now() AND a.starts_at>now() AND a.deleted_at IS NULL
        AND a.status IN ('pendiente','confirmada') AND a.opt_in AND r.appointment_version=a.version
        ORDER BY r.due_at LIMIT 1 FOR UPDATE OF r,a SKIP LOCKED`);
      const row = claim.rows[0];
      if (!row) {
        await lock.query("COMMIT");
        break;
      }
      await lock.query(
        "UPDATE agenda_reminders SET status='processing',attempts=attempts+1,claimed_at=now(),updated_at=now() WHERE id=$1",
        [row.reminder_id],
      );
      await lock.query("COMMIT");
      const local = agendaLocalParts(new Date(row.starts_at), row.time_zone);
      try {
        const message = await sendMessage({
          from: process.env["TWILIO_WHATSAPP_FROM"]!,
          to: `whatsapp:${row.phone}`,
          contentSid: process.env["TWILIO_WHATSAPP_CONTENT_SID"]!,
          contentVariables: JSON.stringify({
            "1": row.name,
            "2": local.date,
            "3": local.time,
            "4": row.service || "visita",
            "5": row.reply_code,
          }),
          statusCallback: `${process.env["AGENDA_PUBLIC_URL"]!.replace(/\/$/, "")}/api/agenda/webhooks/status?rid=${row.reminder_id}`,
        });
        // A signed callback may arrive first. Never downgrade delivered/read.
        await lock.query(
          `UPDATE agenda_reminders SET provider_sid=COALESCE(provider_sid,$2),status=CASE WHEN status IN ('processing','unknown') THEN $3 ELSE status END,updated_at=now() WHERE id=$1`,
          [row.reminder_id, message.sid, message.status],
        );
        sent++;
      } catch (error) {
        const e = error as { status?: number; code?: number };
        const definite =
          typeof e.status === "number" && e.status >= 400 && e.status < 500;
        await lock.query(
          "UPDATE agenda_reminders SET status=$2,error_code=$3,updated_at=now() WHERE id=$1 AND status='processing'",
          [
            row.reminder_id,
            definite ? "failed" : "unknown",
            String(
              e.code || (definite ? "PROVIDER_REJECTED" : "DELIVERY_UNCERTAIN"),
            ),
          ],
        );
        // Avoid draining all future messages on bad credentials/quota/network.
        break;
      }
    }
    return { skipped: false, sent };
  } catch (error) {
    await lock.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await lock.query("SELECT pg_advisory_unlock(740271)").catch(() => {});
    lock.release();
  }
}

export async function recordDelivery(
  reminderId: string,
  sid: string,
  status: string,
  errorCode?: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(reminderId) || !/^SM[a-f0-9]{32}$/i.test(sid))
    return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT * FROM agenda_reminders WHERE id=$1 FOR UPDATE",
      [reminderId],
    );
    const row = result.rows[0];
    if (row && (!row.provider_sid || row.provider_sid === sid)) {
      const next = nextDeliveryStatus(row.status, status);
      await client.query(
        "UPDATE agenda_reminders SET provider_sid=$2,status=$3,error_code=CASE WHEN $3 IN ('failed','undelivered') THEN $4 ELSE NULL END,updated_at=now() WHERE id=$1",
        [reminderId, sid, next, errorCode || null],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function recordReply(sid: string, phone: string, body: unknown) {
  if (!/^SM[a-f0-9]{32}$/i.test(sid)) return;
  const action = replyAction(body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO agenda_inbound(provider_sid) VALUES($1) ON CONFLICT DO NOTHING RETURNING provider_sid",
      [sid],
    );
    if (inserted.rowCount && action) {
      // Exact appointment code + originating phone: a duplicate or late answer
      // cannot accidentally confirm/cancel the sender's next appointment.
      const changed = await client.query(
        `UPDATE agenda_appointments SET status=$3,updated_at=now(),version=version+1 WHERE reply_code=$1 AND phone=$2 AND starts_at>now() AND deleted_at IS NULL AND status IN ('pendiente','confirmada') RETURNING id,version`,
        [action.code, phone.replace(/^whatsapp:/, ""), action.action],
      );
      if (changed.rows[0]) {
        const row = changed.rows[0];
        if (action.action === "cancelada")
          await client.query(
            "UPDATE agenda_reminders SET status='cancelled',updated_at=now() WHERE appointment_id=$1 AND status='scheduled'",
            [row.id],
          );
        else
          await client.query(
            "UPDATE agenda_reminders SET appointment_version=$2 WHERE appointment_id=$1 AND status='scheduled'",
            [row.id, row.version],
          );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
