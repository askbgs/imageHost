// Apply db/schema.sql (idempotent). Usage: npm run migrate
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "../lib/db";

async function main() {
  const sql = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Schema is up to date.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
