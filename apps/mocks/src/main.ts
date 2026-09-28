import { configFromEnv, createApp } from "./app.ts";
import { createDb, migrate } from "./db.ts";

const db = createDb(process.env.DATABASE_URL ?? "postgresql://plandit:plandit@localhost:5432/plandit");
await migrate(db);

const port = Number(process.env.MOCKS_PORT ?? 4100);
createApp(db, configFromEnv()).listen(port, "0.0.0.0", () => {
  console.log(`mocks listening on :${port} — /pg, /relay, /inbox`);
});
