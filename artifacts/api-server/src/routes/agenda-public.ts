import { Router, type IRouter } from "express";
import {
  secureEqual,
  runAgendaReminders,
  validateWhatsAppSignature,
  recordDelivery,
  recordReply,
} from "../lib/agendaWhatsApp";
const router: IRouter = Router();
router.get("/agenda/cron", async (req, res) => {
  const secret = process.env["CRON_SECRET"];
  if (
    !secret ||
    !secureEqual(req.headers.authorization || "", `Bearer ${secret}`)
  ) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(await runAgendaReminders());
});
router.post("/agenda/webhooks/:kind", async (req, res) => {
  if (!["status", "inbound"].includes(String(req.params.kind))) {
    res.sendStatus(404);
    return;
  }
  if (
    !validateWhatsAppSignature(
      req.originalUrl,
      req.header("x-twilio-signature") || "",
      req.body,
    )
  ) {
    res.sendStatus(403);
    return;
  }
  if (req.params.kind === "status")
    await recordDelivery(
      String(req.query.rid || ""),
      String(req.body.MessageSid || ""),
      String(req.body.MessageStatus || ""),
      req.body.ErrorCode,
    );
  else
    await recordReply(
      String(req.body.MessageSid || ""),
      String(req.body.From || ""),
      req.body.ButtonPayload || req.body.Body,
    );
  res.type("text/xml").send("<Response/>");
});
export default router;
