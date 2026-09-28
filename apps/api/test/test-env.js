// e2e tests run against a separate database (plandit_test) and Redis DB 1, never the dev data.
const TEST_DB = "plandit_test";

function testDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://plandit:plandit@localhost:5432/plandit");
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

function testRedisUrl() {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  url.pathname = "/1";
  return url.toString();
}

module.exports = { TEST_DB, testDatabaseUrl, testRedisUrl };
