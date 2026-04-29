// Vercel Function entrypoint for the consolidated deploy.
//
// We ship a plain `.mjs` (no TypeScript) that imports the already-bundled
// Express app from `artifacts/api-server/dist/app.mjs`. Going through the
// pre-bundled JS has two big benefits:
//
//   1. @vercel/node does not attempt to type-check TS sources it cannot
//      resolve against the workspace tsconfig, which was failing the
//      deploy with TS2835 / TS2339 on the api-server internals.
//   2. The bundle is self-contained (esbuild resolved every workspace
//      import), so the function has everything it needs without pnpm
//      symlink acrobatics at runtime.
//
// IMPORTANT: `castores/vercel.json` builds the api-server BEFORE the web
// build, so `dist/app.mjs` always exists when this file is loaded.
import app from "../artifacts/api-server/dist/app.mjs";

export default app;
