export function getConnectionString() {
  return (
    process.env.DATABASE_URL ??
    process.env.DIRECT_URL ??
    "postgresql://plandit:plandit@localhost:5432/plandit"
  );
}
