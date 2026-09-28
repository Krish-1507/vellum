// Applies drizzle/*.sql migrations with plain node-pg (no introspection).
// Usage: node scripts/apply-sql.mjs
import { readFile, readdir } from "fs/promises";
import path from "path";
import pg from "pg";

const { Client } = pg;
const dir = path.join(process.cwd(), "drizzle", "meta");
const root = path.join(process.cwd(), "drizzle");
const { readdir: rd } = await import("fs/promises");
const files = (await rd(root)).filter((f) => f.endsWith(".sql")).sort();

const client = new Client({
  connectionString:
    process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
});
await client.connect();
for (const f of files) {
  const sql = await readFile(path.join(root, f), "utf8");
  // Split on drizzle's statement breakpoints.
  const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  for (const st of statements) {
    await client.query(st);
  }
  console.log(`[apply-sql] applied ${f} (${statements.length} statements)`);
}
const tables = await client.query("select tablename from pg_tables where schemaname='public' order by 1");
console.log("[apply-sql] tables:", tables.rows.map((r) => r.tablename).join(", "));
await client.end();
void dir;
