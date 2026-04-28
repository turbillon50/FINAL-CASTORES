// Vercel Function entrypoint for the consolidated deploy.
// Lives at the monorepo root so the same Vercel project that ships the
// SPA also exposes the Express API under `/api/*`. With `vercel.json`
// rewriting `/api/(.*)` to `/api`, every path Express knows about is
// routed here. The handler is intentionally minimal: it just re-exports
// the Express app from `@workspace/api-server` so all the routing,
// middleware and config lives in one place.
//
// We use a relative import (rather than the workspace specifier) because
// `@workspace/api-server` does not declare a `main` / `exports` map.
// pnpm still wires up the workspace dependency through this package's
// package.json, so all transitive deps resolve correctly when Vercel
// bundles this function.
import app from "../artifacts/api-server/src/app";

export default app;
