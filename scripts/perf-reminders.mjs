// pnpm perf:reminders [KEY=value …] — PLANDIT-30 reminder load test in one command (docs/perf.md).
// Brings up the mock carrier, api (result webhooks) and worker against a separate <db>_perf database, Redis DB 3 and
// ports 4101/4002/4193, so nothing touches the dev data or a running `pnpm dev`; runs the measurement; stops them.
// KEY=value arguments override the settings below, e.g. REMINDER_SEND_CONCURRENCY=20 or PERF_RECIPIENTS=3000.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rootEnv = Object.fromEntries(
  readFileSync(resolve(root, ".env"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]),
);
const database = new URL(rootEnv.DATABASE_URL);
database.pathname += "_perf";
const webhook = "http://localhost:4002/webhooks/relay/mock";

const env = {
  ...process.env,
  ...rootEnv,
  DATABASE_URL: database.href,
  DIRECT_URL: database.href,
  REDIS_URL: "redis://localhost:6379/3",
  API_PORT: "4002",
  WORKER_METRICS_PORT: "4193",
  MOCKS_PORT: "4101",
  MOCKS_PUBLIC_URL: "http://localhost:4101",
  MOCK_RELAY_BASE_URL: "http://localhost:4101/relay",
  RELAY_WEBHOOK_URL: webhook,
  MOCK_RELAY_WEBHOOK_URL: webhook,
  // The carrier: 20 requests a second, results 3 s later, no random failures (so every failure is ours)
  RELAY_RPS: "20",
  RELAY_DELAY_MS: "3000",
  RELAY_FAIL_RATE: "0",
  LOG_LEVEL: "error",
  LLM_PROVIDER: "mock",
  EMBEDDING_PROVIDER: "hash",
  ...Object.fromEntries(process.argv.slice(2).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)])),
};

const children = [];
function start(cwd, ...args) {
  const child = spawn(process.execPath, args, { cwd: resolve(root, cwd), env, stdio: ["ignore", "inherit", "inherit"] });
  children.push(child);
  return child;
}
const run = (cwd, ...args) =>
  new Promise((done, fail) => start(cwd, ...args).on("exit", (code) => (code ? fail(new Error(`${args.at(-1)} exited ${code}`)) : done())));

async function ready(url) {
  for (let i = 0; i < 120; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

const tsNode = ["node_modules/ts-node/dist/bin.js", "-r", "tsconfig-paths/register"];
try {
  await run("packages/database", "node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.config.ts");
  start("apps/mocks", "src/main.ts");
  start("apps/api", ...tsNode, "src/main.ts");
  start("apps/api", ...tsNode, "src/worker.ts");
  await Promise.all([ready("http://localhost:4101/health"), ready("http://localhost:4002/health"), ready("http://localhost:4193/metrics")]);
  console.log(`carrier ${env.RELAY_RPS}/s · paced at ${env.RELAY_SEND_RPS ?? 20}/s · concurrency ${env.REMINDER_SEND_CONCURRENCY ?? 10} · attempts ${env.RELAY_SEND_ATTEMPTS ?? 6}`);
  await run("apps/api", ...tsNode, "src/scripts/perf-reminders.ts");
} finally {
  for (const child of children) child.kill();
}
