import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Lazy connection: we only build the Pool / drizzle client the first time
// somebody actually touches `pool` or `db`. Throwing at import time would
// take down the entire serverless function (including endpoints that don't
// need a database, like /api/healthz) when DATABASE_URL is missing.
let _pool: pg.Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

function sanitizeConnectionUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // PgBouncer (Neon pooler, etc.) does not implement the SCRAM channel-binding
    // extension, so passing channel_binding=require causes an auth handshake
    // failure. Strip it here so the app works regardless of which flavour of
    // connection string the user copies from the Neon console.
    u.searchParams.delete("channel_binding");
    return u.toString();
  } catch {
    return raw;
  }
}

function ensureConnection(): void {
  if (_pool && _db) return;
  const raw = process.env["DATABASE_URL"];
  if (!raw) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  const url = sanitizeConnectionUrl(raw);
  // Managed Postgres providers (Neon, Supabase, Railway, etc.) require SSL.
  // Detect when SSL should be enabled and trust the provider's certificate.
  const needsSsl =
    /sslmode=require/i.test(url) ||
    /\.neon\.tech/i.test(url) ||
    /\.supabase\.co/i.test(url) ||
    /\.render\.com/i.test(url) ||
    /\.railway\.app/i.test(url) ||
    process.env["PGSSLMODE"] === "require";

  _pool = new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  _db = drizzle(_pool, { schema });
}

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop, _receiver) {
    ensureConnection();
    return Reflect.get(_pool as object, prop, _pool);
  },
}) as pg.Pool;

export const db: NodePgDatabase<typeof schema> = new Proxy(
  {} as NodePgDatabase<typeof schema>,
  {
    get(_target, prop, _receiver) {
      ensureConnection();
      return Reflect.get(_db as object, prop, _db);
    },
  },
) as NodePgDatabase<typeof schema>;

export * from "./schema";
