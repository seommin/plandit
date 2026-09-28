import pg from "pg";

export type Db = pg.Pool;

export function createDb(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 5 });
}

/**
 * The mock servers own their tables in a separate `mock` schema and create them on startup.
 * They are not part of the product's Prisma schema: a real PG/carrier's database is not ours either.
 */
export async function migrate(db: Db) {
  await db.query(`
    CREATE SCHEMA IF NOT EXISTS mock;

    CREATE TABLE IF NOT EXISTS mock.pg_transactions (
      tx_id             text PRIMARY KEY,
      merchant_trade_id text NOT NULL UNIQUE,
      amount            integer NOT NULL,
      scenario          text NOT NULL,
      status            text NOT NULL,
      method            text,
      failure_code      text,
      return_url        text NOT NULL,
      webhook_url       text NOT NULL,
      created_at        timestamptz NOT NULL DEFAULT now(),
      approved_at       timestamptz,
      canceled_at       timestamptz
    );

    CREATE TABLE IF NOT EXISTS mock.pg_events (
      event_id         text PRIMARY KEY,
      tx_id            text NOT NULL REFERENCES mock.pg_transactions(tx_id),
      type             text NOT NULL,
      payload          jsonb NOT NULL,
      sent_count       integer NOT NULL DEFAULT 0,
      last_http_status integer,
      created_at       timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mock.relay_messages (
      msg_id           text PRIMARY KEY,
      client_ref       text,
      phone            text NOT NULL,
      kind             text NOT NULL,
      body             text NOT NULL,
      status           text NOT NULL,
      fail_code        text,
      callback_url     text NOT NULL,
      event_id         text UNIQUE,
      sent_count       integer NOT NULL DEFAULT 0,
      last_http_status integer,
      created_at       timestamptz NOT NULL DEFAULT now(),
      result_at        timestamptz
    );
    CREATE INDEX IF NOT EXISTS relay_messages_phone_idx ON mock.relay_messages (phone, created_at DESC);
  `);
}
