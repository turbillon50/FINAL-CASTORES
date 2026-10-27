import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
const win = new Window({ url: "https://castores.test/agenda" });
for (const key of [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
  "Event",
  "MouseEvent",
  "MutationObserver",
  "getComputedStyle",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? win : win[key],
  });
globalThis.addEventListener = win.addEventListener.bind(win);
globalThis.removeEventListener = win.removeEventListener.bind(win);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
win.scrollTo = () => {};
win.confirm = () => true;
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { default: Agenda } =
  await import("../artifacts/castores-control/src/pages/agenda.tsx");
const { calls } = await import("./support/agenda-ui-api.mjs");
function setInput(id, value) {
  const input = document.getElementById(id);
  const proto =
    input.tagName === "TEXTAREA"
      ? win.HTMLTextAreaElement.prototype
      : input.tagName === "SELECT"
        ? win.HTMLSelectElement.prototype
        : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  input.dispatchEvent(new win.Event("change", { bubbles: true }));
}
async function settle() {
  await new Promise((r) => setTimeout(r, 30));
}
test("agenda UI creates, rereads, prepares WhatsApp and deletes without claiming delivery", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  try {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Agenda),
        ),
      );
      await settle();
    });
    await act(settle);
    assert.match(container.textContent, /Agenda de citas/);
    assert.match(container.textContent, /pulsa Enviar/);
    assert.doesNotMatch(container.textContent, /activación|automáticos|Twilio/);
    await act(async () => {
      setInput("agenda-name", "Cliente QA");
      setInput("agenda-phone", "8112345678");
      setInput("agenda-date", "2030-11-03");
      setInput("agenda-time", "09:00");
      setInput("agenda-service", "Visita de revisión");
    });
    await act(async () => {
      container
        .querySelector("form")
        .dispatchEvent(
          new win.Event("submit", { bubbles: true, cancelable: true }),
        );
      await settle();
    });
    await act(settle);
    const sent = calls.find((c) => c.method === "POST");
    assert.ok(sent);
    assert.equal(JSON.parse(sent.body).name, "Cliente QA");
    assert.equal(JSON.parse(sent.body).optIn, false);
    const article = container.querySelector("article");
    assert.ok(article);
    assert.match(article.textContent, /Cliente QA/);
    const whatsapp = article.querySelector("a");
    assert.match(whatsapp.href, /https:\/\/wa.me\/528112345678/);
    assert.match(decodeURIComponent(whatsapp.href), /Cliente QA/);
    assert.ok(!article.textContent.includes("Entregado"));
    const del = Array.from(article.querySelectorAll("button")).find(
      (b) => b.textContent === "Eliminar",
    );
    await act(async () => {
      del.click();
      await settle();
    });
    await act(settle);
    assert.equal(container.querySelector("article"), null);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    await win.happyDOM.close();
  }
});
