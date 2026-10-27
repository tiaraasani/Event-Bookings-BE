import { afterAll, beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";

// https://www.prisma.io/docs/orm/v7/prisma-client/queries/crud#delete-all-records
beforeEach(async () => {
  const tablenames = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public';
  `;

  const tables = tablenames
    .map(({ tablename }) => tablename)
    .filter((name) => name !== "_prisma_migrations")
    .map((name) => `"public"."${name}"`)
    .join(", ");

  if (tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});
