import { execFile, execFileSync } from "node:child_process";
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
  configureDockerHost();

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
 * Testcontainers does not read Docker CLI contexts, so on runtimes that do not
 * expose /var/run/docker.sock (Colima, Rancher Desktop, rootless Docker) it
 * cannot find the daemon. When DOCKER_HOST is unset, point it at the endpoint
 * of the active Docker context instead, as `docker ps` would. Values already
 * set in the environment always win, and non-unix endpoints, such as the named
 * pipe used by Docker Desktop on Windows, are left to Testcontainers.
 */
function configureDockerHost() {
  if (process.env.DOCKER_HOST) {
    return;
  }

  try {
    const host = execFileSync(
      "docker",
      ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();

    if (!host.startsWith("unix://") || host === "unix:///var/run/docker.sock") {
      return;
    }

    process.env.DOCKER_HOST = host;
    // The path the daemon, not this machine, sees the socket at; it is mounted
    // into the Ryuk cleanup container.
    process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??=
      "/var/run/docker.sock";
  } catch {
    // No Docker CLI or context; let Testcontainers report what it can't find.
  }
}

/**
 * Runs the Sequelize migrations against the given database, the same way
 * `yarn db:migrate` does for a developer.
 *
 * @param databaseUrl the Postgres connection string to migrate.
 */
async function migrate(databaseUrl: string) {
  await execFileAsync("yarn", ["sequelize", "db:migrate"], {
    // yarn is a .cmd shim on Windows, which cannot be spawned without a shell.
    shell: process.platform === "win32",
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
    },
  });
}
