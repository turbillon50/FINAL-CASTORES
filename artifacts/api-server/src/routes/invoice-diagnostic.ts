import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { secureEqual } from "../lib/agendaWhatsApp";
import { parseScanJson, scanWithGemini } from "../lib/invoiceScan";

// Infrastructure diagnostic: checks the live dependency without exporting any
// credentials or writing business data. Same server-only secret as the cron.
const router: IRouter = Router();
router.post("/internal/invoice-diagnostic", async (req, res) => {
  const secret = process.env["CRON_SECRET"];
  if (
    !secret ||
    !secureEqual(req.headers.authorization || "", `Bearer ${secret}`)
  ) {
    res.sendStatus(401);
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  const image = req.body?.image;
  if (
    typeof image !== "string" ||
    image.length > 4 * 1024 * 1024 ||
    !/^data:image\/(jpeg|png|webp);base64,/.test(image)
  ) {
    res.status(400).json({ error: "Imagen no válida" });
    return;
  }
  const key = process.env["GEMINI_API_KEY"];
  if (!key) {
    res.status(503).json({ configured: false });
    return;
  }
  try {
    await pool.query("SELECT 1");
    const result = await scanWithGemini(key, image, AbortSignal.timeout(50000));
    if (!result.ok) {
      res
        .status(502)
        .json({
          database: true,
          provider: false,
          status: result.status,
          code: result.code,
          model: result.model,
        });
      return;
    }
    const parsed = parseScanJson(result.text);
    res
      .status(parsed ? 200 : 502)
      .json({
        database: true,
        provider: true,
        model: result.model,
        parsed: !!parsed,
        ...(parsed ? { result: parsed } : {}),
      });
  } catch (error) {
    res
      .status(502)
      .json({
        ok: false,
        error: error instanceof Error ? error.name : "DependencyError",
      });
  }
});
export default router;
