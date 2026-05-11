import { pool } from "@workspace/db";
import { INIT_SQL, SEED_ROLE_PERMISSIONS_SQL } from "../routes/admin-db-init";
import { logger } from "./logger";

/**
 * Aplica el esquema y semillas en cada cold start.
 *
 * Por qué auto-migrar: los CREATE TABLE / ALTER son idempotentes
 * (IF NOT EXISTS / ALTER COLUMN TYPE ... USING). En cada deploy que
 * agrega columnas o tablas nuevas, los endpoints del código nuevo se
 * romperían contra una DB en el esquema viejo hasta que alguien
 * disparara manualmente /api/admin/db-init. Hacerlo automático nos
 * evita el modo "deploy + olvidar prender la migración" que dejó
 * notas, push y notas-de-mostrador rotos en la prod del cliente.
 *
 * Cualquier error se loguea pero NO crashea el server — preferimos
 * que la app suba degradada (con endpoints fallando) a quedarnos
 * sin Express respondiendo. Vercel reintenta cold start; si la DB
 * está caída habrá ruido pero no apocalipsis.
 *
 * Se ejecuta una sola vez por proceso (lifetime de la función
 * serverless de Vercel). La bandera local evita reentrada si por
 * alguna razón la importan dos veces.
 */
let migrated = false;
let migrating: Promise<void> | null = null;

export function runStartupMigrations(): Promise<void> {
  if (migrated) return Promise.resolve();
  if (migrating) return migrating;
  migrating = (async () => {
    const started = Date.now();
    try {
      const client = await pool.connect();
      try {
        await client.query(INIT_SQL);
        await client.query(SEED_ROLE_PERMISSIONS_SQL);
        migrated = true;
        logger.info({ ms: Date.now() - started }, "startup-migrations: applied");
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error({ err, ms: Date.now() - started }, "startup-migrations: FAILED (server continues degraded)");
    } finally {
      migrating = null;
    }
  })();
  return migrating;
}
