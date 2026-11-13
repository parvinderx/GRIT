/**
 * Hand-rolled SQL migrator. We author raw .sql (triggers, EXCLUDE constraints,
 * partial indexes, PL/pgSQL) that no ORM can express, and apply them in order,
 * each in its own transaction, tracked in _migrations.
 *
 *   npm run db:migrate          apply pending migrations
 *   npm run db:reset            drop & recreate schema, then apply all
 */
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const reset = process.argv.includes("--reset");
const dir = join(process.cwd(), "drizzle", "migrations");
const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  if (reset) {
    await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    console.log("✓ reset schema public");
  }
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     );`
  );
  const applied = new Set(
    (await sql`SELECT name FROM _migrations`).map((r) => r.name as string)
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let count = 0;
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`· skip ${f}`);
      continue;
    }
    const content = readFileSync(join(dir, f), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO _migrations (name) VALUES (${f})`;
    });
    console.log(`✓ applied ${f}`);
    count++;
  }
  console.log(count ? `Done (${count} applied).` : "Up to date.");
  await sql.end();
}

main().catch(async (e) => {
  console.error("Migration failed:", e);
  await sql.end();
  process.exit(1);
});
