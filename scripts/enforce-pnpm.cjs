/**
 * Cross-platform preinstall: require pnpm (no POSIX shell).
 * Optionally strip competing lockfiles when present.
 */
const fs = require("fs");
const path = require("path");

const ua = process.env.npm_config_user_agent || "";
if (!ua.startsWith("pnpm/")) {
  console.error("This workspace must be installed with pnpm.");
  console.error("See README or use: corepack enable && pnpm install");
  process.exit(1);
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
