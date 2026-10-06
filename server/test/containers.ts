import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";

const execFileAsync = promisify(execFile);

export interface TestContainers {
  /** Connection string of the migrated Postgres container. */
  databaseUrl: string;
  /** Connection string of the Redis container. */
  redisUrl: string;
  /** Stops and removes both containers. */
  stop: () => Promise<void>;
}

/**
 * Starts disposable Postgres and Redis containers that match the versions
 * pinned in docker-compose.yml, and applies all database migrations to
 * Postgres.
 *
 * @returns connection details for both services and a function to stop them.
 * @throws if Docker is unavailable or the migrations fail.
 */
export async function startContainers(): Promise<TestContainers> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer("postgres:17")
      .withDatabase("outline-test")
      .withUsername("user")
      .withPassword("pass")
      .start(),
    new RedisContainer("redis:8").start(),
  ]);

  const stop = async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };

  const databaseUrl = postgres.getConnectionUri();
  const redisUrl = redis.getConnectionUrl();

  try {
    await migrate(databaseUrl);
  } catch (err) {
    await stop();
    throw err;
  }

  return { databaseUrl, redisUrl, stop };
}

/**
 * Runs the Sequelize migrations against the given database, the same way
 * `yarn db:migrate` does for a developer.
 *
 * @param databaseUrl the Postgres connection string to migrate.
 */
async function migrate(databaseUrl: string) {
  await execFileAsync("yarn", ["sequelize", "db:migrate"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
    },
  });
}
