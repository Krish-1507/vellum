// Zero-config local Postgres for development.
// Usage: npm run db:local
// Starts an embedded Postgres on 127.0.0.1:5432 with data persisted in ./data/pg.
// Matches the default DATABASE_URL in .env.example. First run downloads the
// Postgres binaries (~50MB, one time). Keep it running in its own terminal,
// then in another terminal: npx drizzle-kit push && npm run dev.
import EmbeddedPostgres from "embedded-postgres";
import path from "path";

const dataDir = path.join(process.cwd(), "data", "pg");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: 5432,
  persistent: true,
});

console.log(`[db:local] data dir: ${dataDir}`);
try {
  await pg.initialise();
} catch (err) {
  // Already initialised from a previous run — safe to continue.
  console.log("[db:local] initialise skipped (already set up)");
}
await pg.start();
console.log("[db:local] Postgres is up on 127.0.0.1:5432 (user postgres / db app_db)");
console.log("[db:local] Next: npx drizzle-kit push   then   npm run dev");

const shutdown = async () => {
  console.log("\n[db:local] stopping…");
  try {
    await pg.stop();
  } catch {}
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Ensure the app database exists.
const { Client } = await import("pg");
const admin = new Client({
  host: "127.0.0.1",
  port: 5432,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
await admin.connect();
await admin.query("SELECT 1");
const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'app_db'");
if (found.rowCount === 0) {
  // template0 + explicit UTF8: the cluster may be initialised with a
  // WIN1252 locale on some Windows machines, which cannot store contract
  // text or model output (em-dashes, quotes, Arabic, …).
  await admin.query("CREATE DATABASE app_db WITH ENCODING 'UTF8' TEMPLATE template0");
  console.log("[db:local] created database app_db (UTF8)");
} else {
  const enc = await admin.query(
    "SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = 'app_db'",
  );
  if (enc.rows[0]?.enc !== "UTF8") {
    console.log(`[db:local] app_db is ${enc.rows[0]?.enc}, recreating as UTF8…`);
    await admin.query("DROP DATABASE app_db");
    await admin.query("CREATE DATABASE app_db WITH ENCODING 'UTF8' TEMPLATE template0");
    console.log("[db:local] recreated database app_db (UTF8) — re-run: node scripts/apply-sql.mjs");
  } else {
    console.log("[db:local] database app_db already exists (UTF8)");
  }
}
await admin.end();

// Park the process so Postgres keeps running until Ctrl+C.
await new Promise(() => {});
