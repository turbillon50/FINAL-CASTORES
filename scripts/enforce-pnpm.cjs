/**
 * Cross-platform preinstall: require pnpm (no POSIX shell).
 * Optionally strip competing lockfiles when present.
 *
 * Detección permisiva por capas:
 *   1. CI/Vercel: si VERCEL=1 o CI=true asumimos que el orquestador
 *      ya usa el package manager correcto (Vercel invoca explícitamente
 *      `corepack pnpm install`). pnpm 10.x / corepack ya no exponen
 *      `npm_config_user_agent` como `pnpm/...` en algunas versiones,
 *      lo que hacía fallar este preinstall y bloqueaba el deploy.
 *   2. user_agent empieza con pnpm/ → ok
 *   3. PNPM_PACKAGE_NAME o pnpm_* env vars presentes → ok
 *   4. user_agent empieza con npm/ o yarn/ → fail (intencional)
 *   5. Sin señal clara → warn pero permitir, evita falsos positivos.
 */
const fs = require("fs");
const path = require("path");

const ua = process.env.npm_config_user_agent || "";
const isCI = process.env.CI === "true" || process.env.VERCEL === "1" || !!process.env.VERCEL_URL;
const looksLikePnpm =
  ua.startsWith("pnpm/") ||
  !!process.env.PNPM_PACKAGE_NAME ||
  !!process.env.pnpm_config_user_agent ||
  /pnpm/i.test(process.env.npm_execpath || "");
const looksLikeNpmOrYarn = ua.startsWith("npm/") || ua.startsWith("yarn/");

if (!isCI && !looksLikePnpm && looksLikeNpmOrYarn) {
  console.error("This workspace must be installed with pnpm.");
  console.error("See README or use: corepack enable && pnpm install");
  process.exit(1);
}

if (!isCI && !looksLikePnpm && !looksLikeNpmOrYarn) {
  // No tenemos certeza del package manager. Solo advertimos para no
  // bloquear flujos legítimos donde corepack/pnpm no expone user agent.
  console.warn("[preinstall] Could not detect package manager from environment. Continuing.");
}

const root = path.join(__dirname, "..");
for (const f of ["package-lock.json", "yarn.lock"]) {
  const p = path.join(root, f);
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if (e && e.code !== "ENOENT") throw e;
  }
}
