// Create (or reuse) a user and issue an API key.
// Usage: npm run create-key -- <email> [key name] [uploads per hour]
//   e.g. npm run create-key -- you@example.com "n8n automations" 500
import { createKey } from "../lib/apikeys";
import { pool, queryOne } from "../lib/db";

async function main() {
  const [email, name = "default", limit = "100"] = process.argv.slice(2);
  if (!email || !email.includes("@")) {
    console.error('Usage: npm run create-key -- <email> [key name] [uploads per hour]');
    process.exit(1);
  }
  const username = email.split("@")[0]!.replace(/[^\w.-]/g, "").slice(0, 32) || "user";

  let user = await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase()]);
  if (!user) {
    user = await queryOne<{ id: string }>(
      `INSERT INTO users (email, username) VALUES ($1, $2 || '-' || substr(md5(random()::text), 1, 4)) RETURNING id`,
      [email.toLowerCase(), username],
    );
  }
  const raw = await createKey(user!.id, name, Number.parseInt(limit, 10) || 100);
  console.log(`API key for ${email} (${name}, ${limit}/hour):\n\n  ${raw}\n\nStore it now; only its hash is saved.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
