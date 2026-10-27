import { build } from "../artifacts/api-server/node_modules/esbuild/lib/main.js";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
const outfile = resolve(
  "artifacts/castores-control/.test-build/agenda-ui.test.mjs",
);
await build({
  entryPoints: ["tests/agenda-ui.test.mjs"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  jsx: "automatic",
  loader: { ".css": "empty" },
  alias: {
    "@/lib/auth": resolve("tests/support/agenda-ui-auth.mjs"),
    "@workspace/api-client-react": resolve("tests/support/agenda-ui-api.mjs"),
  },
});
const run = spawnSync(process.execPath, ["--test", outfile], {
  stdio: "inherit",
});
rmSync(resolve("artifacts/castores-control/.test-build"), {
  recursive: true,
  force: true,
});
process.exitCode = run.status ?? 1;
