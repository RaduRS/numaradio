import { Pool } from "pg";

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  pool = new Pool({
    connectionString: url,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  });
  return pool;
}
