import { build } from "../artifacts/api-server/node_modules/esbuild/lib/main.js";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
const outfile = resolve(
  "artifacts/api-server/.test-build/agenda.integration.mjs",
);
await build({
  entryPoints: ["tests/agenda.integration.mjs"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { "@workspace/db": resolve("tests/support/agenda-db.mjs") },
  plugins: [
    {
      name: "test-auth-only",
      setup(b) {
        b.onResolve({ filter: /\/lib\/authContext$/ }, () => ({
          path: resolve("tests/support/agenda-auth.mjs"),
        }));
      },
    },
  ],
});
const run = spawnSync(process.execPath, ["--test", outfile], {
  stdio: "inherit",
});
rmSync(resolve("artifacts/api-server/.test-build"), {
  recursive: true,
  force: true,
});
process.exitCode = run.status ?? 1;
