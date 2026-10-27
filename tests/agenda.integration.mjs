import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import twilio from "twilio";
import { pg, pool } from "./support/agenda-db.mjs";
import router from "../artifacts/api-server/src/routes/agenda.ts";
import diagnosticRouter from "../artifacts/api-server/src/routes/invoice-diagnostic.ts";
import publicRouter from "../artifacts/api-server/src/routes/agenda-public.ts";
import { AGENDA_SQL } from "../artifacts/api-server/src/lib/agenda.ts";
import {
  recordDelivery,
  recordReply,
  runAgendaReminders,
} from "../artifacts/api-server/src/lib/agendaWhatsApp.ts";

test("agenda HTTP + Postgres persistence, ownership, scheduling and webhooks", async (t) => {
  await pg.exec(
    "CREATE TABLE users(id integer PRIMARY KEY);INSERT INTO users VALUES(1),(2)",
  );
  await pg.exec(AGENDA_SQL);
  await pg.exec(AGENDA_SQL); // idempotent cold starts
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/api", publicRouter);
  app.use("/api", diagnosticRouter);
  app.use((req, res, next) => {
    req.authUser = {
      id: Number(req.headers["x-test-owner"] || 1),
      role: req.headers["x-test-role"] || "admin",
    };
    next();
  });
  app.use("/api", router);
  app.use((err, req, res, next) =>
    res.status(500).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = "GET", body, headers = {}) {
    const response = await fetch(origin + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  }
  const input = {
    name: "Prueba QA",
    phone: "8112345678",
    date: "2030-11-03",
    time: "09:00",
    timeZone: "America/Mexico_City",
    service: "Visita",
    optIn: true,
  };
  let appointment;
  try {
    await t.test("invoice infrastructure diagnostic denies missing and incorrect secrets", async () => {
      delete process.env.CRON_SECRET;
      assert.equal((await request('/internal/invoice-diagnostic','POST',{image:'data:image/jpeg;base64,YQ=='})).status,401);
      process.env.CRON_SECRET='test-secret';
      assert.equal((await request('/internal/invoice-diagnostic','POST',{}, {Authorization:'Bearer wrong'})).status,401);
    });
    await t.test("non-admins cannot read the private agenda", async () => {
      assert.equal(
        (await request("/agenda", "GET", null, { "x-test-role": "worker" }))
          .status,
        403,
      );
    });
    await t.test(
      "create persists, normalizes phone and schedules both reminders",
      async () => {
        const result = await request("/agenda/appointments", "POST", input);
        assert.equal(result.status, 201, JSON.stringify(result.body));
        appointment = result.body;
        assert.equal(appointment.phone, "+528112345678");
        assert.equal(appointment.reminders.length, 2);
        assert.equal(appointment.starts_at, "2030-11-03T15:00:00.000Z");
        assert.equal(
          (await request("/agenda")).body.appointments[0].id,
          appointment.id,
        );
        assert.equal(
          (await request("/agenda", "GET", null, { "x-test-owner": "2" })).body
            .appointments.length,
          0,
        );
      },
    );
    await t.test(
      "another administrator cannot edit someone else’s appointment",
      async () => {
        assert.equal(
          (
            await request(
              `/agenda/appointments/${appointment.id}`,
              "PUT",
              { ...input, version: 1 },
              { "x-test-owner": "2" },
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      "edit reschedules and stale writes do not overwrite it",
      async () => {
        const result = await request(
          `/agenda/appointments/${appointment.id}`,
          "PUT",
          { ...input, time: "10:00", version: 1 },
        );
        assert.equal(result.status, 200, JSON.stringify(result.body));
        appointment = result.body;
        assert.equal(appointment.version, 2);
        assert.equal(appointment.reminders.length, 2);
        const old = await pool.query(
          "SELECT status FROM agenda_reminders WHERE appointment_id=$1 AND appointment_version=1",
          [appointment.id],
        );
        assert.ok(old.rows.every((r) => r.status === "cancelled"));
        assert.equal(
          (
            await request(`/agenda/appointments/${appointment.id}`, "PUT", {
              ...input,
              version: 1,
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "template survives reread and is scoped to the owner",
      async () => {
        assert.equal(
          (
            await request("/agenda/settings", "PUT", {
              template: "Hola {cliente}",
            })
          ).status,
          200,
        );
        assert.equal(
          (await request("/agenda")).body.template,
          "Hola {cliente}",
        );
        assert.notEqual(
          (await request("/agenda", "GET", null, { "x-test-owner": "2" })).body
            .template,
          "Hola {cliente}",
        );
      },
    );
    await t.test(
      "duplicate and out-of-order delivery callbacks preserve delivered state",
      async () => {
        const id = appointment.reminders[0].id,
          sid = "SM" + "a".repeat(32);
        await recordDelivery(id, sid, "delivered");
        await recordDelivery(id, sid, "sent");
        await recordDelivery(id, sid, "delivered");
        assert.equal(
          (
            await pool.query(
              "SELECT status FROM agenda_reminders WHERE id=$1",
              [id],
            )
          ).rows[0].status,
          "delivered",
        );
      },
    );
    await t.test(
      "unsigned webhooks and missing/wrong cron authorization fail closed",
      async () => {
        assert.equal(
          (
            await request("/agenda/webhooks/inbound", "POST", {
              Body: "CANCELAR " + appointment.reply_code,
            })
          ).status,
          403,
        );
        delete process.env.CRON_SECRET;
        assert.equal((await request("/agenda/cron")).status, 401);
        process.env.CRON_SECRET = "test-secret";
        assert.equal((await request("/agenda/cron")).status, 401);
        assert.equal(
          (
            await request("/agenda/cron", "GET", null, {
              Authorization: "Bearer test-secret",
            })
          ).body.skipped,
          true,
        );
      },
    );
    await t.test(
      "signed incoming cancellation is applied only once to the exact appointment",
      async () => {
        process.env.TWILIO_AUTH_TOKEN = "test-twilio-token";
        process.env.AGENDA_PUBLIC_URL = "https://agenda.example.test";
        const params = {
          MessageSid: "SM" + "b".repeat(32),
          From: "whatsapp:" + appointment.phone,
          Body: "CANCELAR " + appointment.reply_code,
        };
        const signature = twilio.getExpectedTwilioSignature(
          process.env.TWILIO_AUTH_TOKEN,
          process.env.AGENDA_PUBLIC_URL + "/api/agenda/webhooks/inbound",
          params,
        );
        const call = () =>
          fetch(origin + "/api/agenda/webhooks/inbound", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "x-twilio-signature": signature,
            },
            body: new URLSearchParams(params),
          });
        assert.equal((await call()).status, 200);
        assert.equal((await call()).status, 200);
        const row = (
          await pool.query(
            "SELECT status,version FROM agenda_appointments WHERE id=$1",
            [appointment.id],
          )
        ).rows[0];
        assert.equal(row.status, "cancelada");
        assert.equal(row.version, 3);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM agenda_reminders WHERE appointment_id=$1 AND status='scheduled'",
              [appointment.id],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "outbox sends once and never retries ambiguous delivery",
      async () => {
        Object.assign(process.env, {
          AGENDA_WHATSAPP_ENABLED: "true",
          TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
          TWILIO_WHATSAPP_FROM: "whatsapp:+15555550100",
          TWILIO_WHATSAPP_CONTENT_SID: "HX" + "a".repeat(32),
        });
        const created = await request("/agenda/appointments", "POST", input);
        await pool.query(
          "UPDATE agenda_reminders SET due_at=now()-interval '1 minute' WHERE appointment_id=$1 AND offset_hours=24",
          [created.body.id],
        );
        let calls = 0;
        const sender = async (options) => {
          calls++;
          assert.equal(options.to, "whatsapp:+528112345678");
          return { sid: "SM" + "c".repeat(32), status: "queued" };
        };
        assert.equal((await runAgendaReminders(sender)).sent, 1);
        assert.equal((await runAgendaReminders(sender)).sent, 0);
        assert.equal(calls, 1);
        await pool.query(
          "UPDATE agenda_reminders SET due_at=now()-interval '1 minute' WHERE appointment_id=$1 AND offset_hours=2",
          [created.body.id],
        );
        const ambiguous = async () => {
          calls++;
          throw new Error("socket closed after submission");
        };
        await runAgendaReminders(ambiguous);
        await runAgendaReminders(ambiguous);
        assert.equal(calls, 2);
        assert.equal(
          (
            await pool.query(
              "SELECT status FROM agenda_reminders WHERE appointment_id=$1 AND offset_hours=2",
              [created.body.id],
            )
          ).rows[0].status,
          "unknown",
        );
        await request(`/agenda/appointments/${created.body.id}`, "DELETE", {
          version: 1,
        });
      },
    );
    await t.test(
      "deletion is persisted and opt-out never schedules a reminder",
      async () => {
        const created = await request("/agenda/appointments", "POST", {
          ...input,
          optIn: false,
        });
        assert.equal(created.body.reminders.length, 0);
        assert.equal(
          (
            await request(`/agenda/appointments/${created.body.id}`, "DELETE", {
              version: 1,
            })
          ).status,
          200,
        );
        assert.equal((await request("/agenda")).body.appointments.length, 1);
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await pg.close();
  }
});
