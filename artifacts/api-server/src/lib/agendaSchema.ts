import { pool } from "@workspace/db";
import { AGENDA_SQL } from "./agenda";

let ready: Promise<void> | null = null;
/** Additive migration, serialized across processes. A failed connection clears
 * the promise so the next request can recover instead of staying broken. */
export function ensureAgendaSchema(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '8s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SELECT pg_advisory_xact_lock(740272)");
      await client.query(AGENDA_SQL);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}
