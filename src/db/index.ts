import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

/**
 * Two clients on purpose:
 *  - `drizzleClient` is handed to Drizzle, which MUTATES it (disables type
 *    parsing so Drizzle can parse itself). Never use it for raw tagged queries.
 *  - `sql` is a separate, pristine client for hand-written SQL (the atomic
 *    booking claim, the clock) — it serializes Date params and parses
 *    timestamptz into Date the normal way.
 * Railway runs one long-lived process, so module-level singletons are correct;
 * cache on globalThis so dev HMR doesn't leak pools.
 */
const g = globalThis as unknown as {
  __gritDrizzleClient?: ReturnType<typeof postgres>;
  __gritRawClient?: ReturnType<typeof postgres>;
};

const drizzleClient =
  g.__gritDrizzleClient ?? postgres(connectionString, { max: 8, onnotice: () => {} });
const rawClient = g.__gritRawClient ?? postgres(connectionString, { max: 8, onnotice: () => {} });

if (process.env.NODE_ENV !== "production") {
  g.__gritDrizzleClient = drizzleClient;
  g.__gritRawClient = rawClient;
}

export const db = drizzle(drizzleClient, { schema });
export const sql = rawClient;
export { schema };
