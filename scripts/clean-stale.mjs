// Runs before every build (npm "prebuild").
//
// Earlier versions of PinPicX had a middleware.ts / proxy.ts that guarded /admin with ADMIN_PASSWORD.
// The current app doesn't have one: admins are the accounts listed in ADMIN_EMAILS. When a new version is
// copied over an old one, that file stays behind and keeps answering /admin with
// "Admin is disabled: set ADMIN_PASSWORD". Remove it (and say so) so it can't shadow the current app.
import { existsSync, rmSync } from "node:fs";

const STALE = [
  "middleware.ts",
  "middleware.js",
  "src/middleware.ts",
  "src/middleware.js",
  "proxy.ts",
  "proxy.js",
  "src/proxy.ts",
  "src/proxy.js",
];

const removed = STALE.filter((f) => existsSync(f));
for (const f of removed) rmSync(f);
if (removed.length) {
  console.warn(
    `\n[prebuild] Removed ${removed.join(", ")} left over from an older version of PinPicX.\n` +
      "           Delete it from your repository too, so it doesn't come back.\n",
  );
}
