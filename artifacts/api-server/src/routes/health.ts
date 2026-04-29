import { Router, type IRouter } from "express";
const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const hasDatabaseUrl = !!process.env["DATABASE_URL"];
  const hasClerkPublishableKey =
    !!(process.env["CLERK_PUBLISHABLE_KEY"] ||
      process.env["VITE_CLERK_PUBLISHABLE_KEY"] ||
      process.env["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]);
  const hasClerkSecretKey = !!process.env["CLERK_SECRET_KEY"];

  res.json({
    ok: true,
    service: "castores-api",
    env: process.env["NODE_ENV"] || "unknown",
    databaseConfigured: hasDatabaseUrl,
    clerkConfigured: hasClerkPublishableKey && hasClerkSecretKey,
  });
});

export default router;
