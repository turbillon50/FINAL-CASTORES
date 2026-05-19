import { pool } from "@workspace/db";
import { INIT_SQL_CHUNKS, SEED_ROLE_PERMISSIONS_SQL } from "../routes/admin-db-init";
import { logger } from "./logger";

/**
 * Aplica el esquema y semillas en cada cold start.
 *
 * Diseño:
 *   - El INIT_SQL grande está partido en chunks lógicos (ver
 *     `INIT_SQL_CHUNKS` en admin-db-init.ts). Si un chunk falla
 *     (timeout, lock, statement nuevo con error), los demás siguen
 *     ejecutándose. Antes todo iba en una sola `client.query()` y un
 *     fallo de un statement abortaba la conexión, dejando la DB en
 *     estado mixto y los endpoints que dependían de columnas nuevas
 *     devolviendo 500 — exactamente lo que pasó al desplegar el módulo
 *     de asistencia. Cada cold start reintenta lo que falló (todas las
 *     cláusulas son IF NOT EXISTS / ON CONFLICT, sin riesgo a datos).
 *
 *   - Antes era fire-and-forget desde app.ts: la primera request entraba
 *     antes de que la migración terminara y rompía con "column does not
 *     exist". Ahora exponemos la promesa para que un middleware al frente
 *     del router pueda await-la (con timeout corto) antes de procesar.
 *
 *   - Si TODOS los chunks pasaron sin error, marcamos `migrated=true` y
 *     el resto del lifetime del proceso no vuelve a tocar la DB. Si algún
 *     chunk falla, el flag NO se levanta — el siguiente cold start
 *     reintenta. Esto es seguro porque las cláusulas son idempotentes.
 *
 *   - Errores se loguean pero NO crashean el server: preferimos que la
 *     app suba degradada (con endpoints fallando) a quedarnos sin Express
 *     respondiendo.
 */
let migrated = false;
let migrating: Promise<void> | null = null;

export function runStartupMigrations(): Promise<void> {
  if (migrated) return Promise.resolve();
  if (migrating) return migrating;
  migrating = (async () => {
    const started = Date.now();
    const failed: Array<{ name: string; detail: string }> = [];
    try {
      const client = await pool.connect();
      try {
        for (const chunk of INIT_SQL_CHUNKS) {
          try {
            await client.query(chunk.sql);
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            failed.push({ name: chunk.name, detail });
            logger.error({ chunk: chunk.name, detail }, "startup-migrations: chunk failed");
          }
        }
        try {
          await client.query(SEED_ROLE_PERMISSIONS_SQL);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          failed.push({ name: "seed-role-permissions", detail });
          logger.error({ chunk: "seed-role-permissions", detail }, "startup-migrations: seed failed");
        }
        if (failed.length === 0) {
          migrated = true;
          logger.info({ ms: Date.now() - started }, "startup-migrations: applied");
        } else {
          // No marcar migrated=true: el siguiente cold start reintenta los
          // chunks fallidos. Los que sí pasaron son no-op en re-intento.
          logger.error(
            { ms: Date.now() - started, failed },
            "startup-migrations: partial — process kept alive degraded",
          );
        }
      } finally {
        client.release();
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.error({ detail, ms: Date.now() - started }, "startup-migrations: OUTER fail (no DB connection)");
    } finally {
      migrating = null;
    }
  })();
  return migrating;
}
