import { Pool, types } from "pg";

// Postgres OID 1114 = `timestamp without time zone`. By default pg-node
// parses these as the Node process's local time, then to a Date object —
// which serializes to a UTC ISO string that's offset by however far local
// is from UTC. Prisma (used by the queue daemon) treats the same column
// as UTC, so the two readers disagree by an hour any time the host TZ
// isn't UTC. Force pg-node to parse 1114 as UTC by appending 'Z' so JS
// reads it as UTC. Brings dashboard reads and Prisma reads into agreement
// without a schema migration to timestamptz.
types.setTypeParser(1114, (val: string) => new Date(val + "Z"));

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
