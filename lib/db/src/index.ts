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

function ensureConnection(): void {
  if (_pool && _db) return;
  if (!process.env["DATABASE_URL"]) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  _pool = new Pool({ connectionString: process.env["DATABASE_URL"] });
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
