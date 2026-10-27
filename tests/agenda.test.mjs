import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhone,
  localToUtc,
  appointmentInput,
  reminderSchedule,
  nextDeliveryStatus,
  replyAction,
} from "../artifacts/api-server/src/lib/agenda.ts";
test("Mexican and international phones normalize without accepting text", () => {
  assert.equal(normalizePhone("81 1234 5678"), "+528112345678");
  assert.equal(normalizePhone("+1 (415) 555-0100"), "+14155550100");
  assert.throws(() => normalizePhone("abc8112345678"));
  assert.throws(() => normalizePhone("123"));
});
test("appointments use the selected zone, not the device timezone", () => {
  assert.equal(
    localToUtc("2026-11-03", "09:00", "America/Mexico_City").toISOString(),
    "2026-11-03T15:00:00.000Z",
  );
  assert.equal(
    localToUtc("2026-11-03", "09:00", "America/Cancun").toISOString(),
    "2026-11-03T14:00:00.000Z",
  );
  assert.throws(() => localToUtc("2026-02-30", "09:00", "America/Cancun"));
  assert.throws(() => localToUtc("2026-03-08", "02:30", "America/Tijuana"));
});
test("24h/2h plan never queues already-passed reminders", () => {
  const start = new Date("2026-11-03T15:00:00Z");
  assert.equal(
    reminderSchedule(start, new Date("2026-11-01T00:00:00Z")).length,
    2,
  );
  assert.deepEqual(
    reminderSchedule(start, new Date("2026-11-03T10:00:00Z")).map(
      (r) => r.hours,
    ),
    [2],
  );
  assert.equal(reminderSchedule(start, start).length, 0);
});
test("delivery callbacks cannot regress or resurrect cancelled messages", () => {
  assert.equal(nextDeliveryStatus("read", "sent"), "read");
  assert.equal(nextDeliveryStatus("delivered", "failed"), "delivered");
  assert.equal(nextDeliveryStatus("sent", "undelivered"), "undelivered");
  assert.equal(nextDeliveryStatus("unknown", "delivered"), "delivered");
  assert.equal(nextDeliveryStatus("cancelled", "sent"), "cancelled");
});
test("confirmation/cancellation requires a precise appointment code", () => {
  assert.deepEqual(replyAction("confirmar A1B2C3D4"), {
    action: "confirmada",
    code: "A1B2C3D4",
  });
  assert.equal(replyAction("2"), null);
  assert.equal(replyAction("cancelar"), null);
});
test("opt-in is explicit, and malformed status/date is refused", () => {
  const v = {
    name: "Test",
    phone: "8112345678",
    date: "2026-11-03",
    time: "09:00",
    optIn: false,
  };
  assert.equal(appointmentInput(v).optIn, false);
  assert.throws(() => appointmentInput({ ...v, optIn: "true" }));
  assert.throws(() => appointmentInput({ ...v, status: "sent" }));
});
