import { QueryTypes } from "sequelize";
import { afterAll, beforeEach } from "vitest";
import Redis from "ioredis";
import env from "@server/env";
import { sequelize } from "@server/storage/database";

/**
 * Registers a hook that gives every test an empty database and Redis, so
 * tests cannot see each other's data. Only valid for projects that run files
 * serially against containers, as it wipes everything.
 */
export function cleanBetweenTests() {
  const redis = new Redis(env.REDIS_URL ?? "");

  beforeEach(async () => {
    const tables = await sequelize.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> 'SequelizeMeta'`,
      { type: QueryTypes.SELECT }
    );
    if (tables.length > 0) {
      const names = tables.map((t) => `"${t.tablename}"`).join(", ");
      await sequelize.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
    }
    await redis.flushall();
  });

  afterAll(() => redis.quit());
}
