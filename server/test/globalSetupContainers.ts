import { startContainers } from "./containers";

/**
 * Vitest global setup for the integration project. Starts the Postgres and
 * Redis containers once for the whole run and points the test environment at
 * them before any worker is spawned.
 *
 * @returns a teardown function that stops the containers.
 */
export default async function setup() {
  const containers = await startContainers();

  process.env.DATABASE_URL = containers.databaseUrl;
  process.env.REDIS_URL = containers.redisUrl;

  return containers.stop;
}
