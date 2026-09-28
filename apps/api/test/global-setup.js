const { execSync } = require("child_process");
const path = require("path");
const { Client } = require("pg");

const { TEST_DB, testDatabaseUrl } = require("./test-env");

/** Creates plandit_test if missing and applies all migrations to it. */
module.exports = async () => {
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB]);
  if (!rowCount) await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const url = testDatabaseUrl();
  execSync("npx prisma migrate deploy --config prisma.config.ts", {
    cwd: path.resolve(__dirname, "../../../packages/database"),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "pipe",
  });
};
