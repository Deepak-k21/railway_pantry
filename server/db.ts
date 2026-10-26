import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile } from "node:fs/promises";

export type Row = Record<string, any>;
export interface Sql {
  query(sql: string, params?: any[]): Promise<{ rows: Row[] }>;
}
export interface Database extends Sql {
  exec(sql: string): Promise<void>;
  transaction<T>(run: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function database(
  url?: string,
  directory?: string,
): Promise<Database> {
  if (url) {
    const isLocal =
      url.includes("localhost") ||
      url.includes("127.0.0.1") ||
      url.includes("::1");
    const pool = new pg.Pool({
      connectionString: url,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
    return {
      exec: async (sql) => {
        await pool.query(sql);
      },
      query: (sql, params) => pool.query(sql, params),
      close: () => pool.end(),
      transaction: async (run) => {
        const connection = await pool.connect();
        try {
          await connection.query("BEGIN");
          await connection.query(
            "SELECT id FROM operation_lock WHERE id=1 FOR UPDATE",
          );
          const result = await run(connection);
          await connection.query("COMMIT");
          return result;
        } catch (error) {
          await connection.query("ROLLBACK");
          throw error;
        } finally {
          connection.release();
        }
      },
    };
  }
  const embedded = new PGlite(directory);
  return {
    exec: async (sql) => {
      await embedded.exec(sql);
    },
    query: (sql, params) => embedded.query(sql, params),
    close: () => embedded.close(),
    transaction: (run) => embedded.transaction((tx) => run(tx)),
  };
}
export async function migrate(db: Database) {
  await db.exec(
    "BEGIN;\n" +
      (await readFile(new URL("./schema.sql", import.meta.url), "utf8")) +
      "\nCOMMIT;",
  );
}
export async function one(sql: Sql, query: string, params: any[] = []) {
  return (await sql.query(query, params)).rows[0];
}
