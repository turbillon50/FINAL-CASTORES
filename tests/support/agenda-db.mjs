import { PGlite } from "@electric-sql/pglite";
export const pg = new PGlite();
export const pool = {
  async query(sql, params = []) {
    const result = sql.includes(
      "CREATE TABLE IF NOT EXISTS agenda_appointments",
    )
      ? (await pg.exec(sql)).at(-1)
      : await pg.query(sql, params);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  },
  async connect() {
    return { query: pool.query, release() {} };
  },
};
