import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUnit,
  parseScanJson,
  scanWithGemini,
  scanErrorMessage,
} from "../artifacts/api-server/src/lib/invoiceScan.ts";
const row = {
  name: "Pintura",
  unit: "GALÓN",
  quantityRequested: 1,
  costPerUnit: 267.86,
};
test("preserves gallons, fractional quantities and all 40 invoice rows", () => {
  const result = parseScanJson(
    JSON.stringify({
      items: Array.from({ length: 40 }, (_, i) => ({
        ...row,
        quantityRequested: i === 39 ? 0.125 : 1,
      })),
      confidence: 0.9,
    }),
  );
  assert.equal(result.items.length, 40);
  assert.equal(result.items[0].unit, "gal");
  assert.equal(result.items[0].costPerUnit, 267.86);
  assert.equal(result.items[39].quantityRequested, 0.125);
  assert.equal(normalizeUnit("LITROS"), "lt");
});
test("retains incomplete rows for review and never invents quantities or costs", () => {
  const result = parseScanJson(
    JSON.stringify({
      items: [
        row,
        { name: "Tubo", unit: "", quantityRequested: "2", costPerUnit: -1 },
        {},
      ],
    }),
  );
  assert.equal(result.items.length, 3);
  assert.equal(result.items[1].quantityRequested, null);
  assert.equal(result.items[1].costPerUnit, null);
  assert.equal(result.warnings.length, 2);
  assert.equal(parseScanJson('{"items":[null]}'), null);
  assert.equal(parseScanJson('{"items":['), null);
});
test("rejects complete-looking JSON when provider says truncated", async () => {
  const result = await scanWithGemini(
    "test",
    "data:image/jpeg;base64,YQ==",
    new AbortController().signal,
    async () =>
      Response.json({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: '{"items":[]}' }] },
          },
        ],
      }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "MAX_TOKENS");
  assert.match(scanErrorMessage(result.status, result.code), /incompleta/);
});
test("authentication failure is not retried and key stays out of URL", async () => {
  let calls = 0;
  const result = await scanWithGemini(
    "private-key",
    "data:image/jpeg;base64,YQ==",
    new AbortController().signal,
    async (url, init) => {
      calls++;
      assert.ok(!url.includes("private-key"));
      assert.equal(init.headers["x-goog-api-key"], "private-key");
      return Response.json(
        { error: { status: "UNAUTHENTICATED" } },
        { status: 401 },
      );
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, 401);
  assert.match(scanErrorMessage(401, result.code), /administrador/);
});
test("one explicit transient failure retries, then returns all text", async () => {
  let calls = 0;
  const result = await scanWithGemini(
    "test",
    "data:image/png;base64,YQ==",
    new AbortController().signal,
    async () =>
      ++calls === 1
        ? new Response("", { status: 503 })
        : Response.json({
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [
                    { text: "hidden", thought: true },
                    { text: '{"items":[]}' },
                  ],
                },
              },
            ],
          }),
  );
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.text, '{"items":[]}');
});
