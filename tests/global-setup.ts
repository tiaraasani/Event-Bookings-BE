import { execSync } from "node:child_process";

/**
 * Prisma Migrate uses a session-level advisory lock. On Neon, that lock can
 * get stuck on a pooled PgBouncer session after a client disconnects, causing
 * P1002 errors on the next run. Run migrations through the direct endpoint.
 */
function getMigrationDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const url = new URL(databaseUrl);
  url.hostname = url.hostname.replace("-pooler.", ".");

  return url.toString();
}

export default function globalSetup() {
  execSync("npx prisma migrate reset --force", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: getMigrationDatabaseUrl(process.env.DATABASE_URL),
    },
  });
}
