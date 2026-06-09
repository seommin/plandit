# Docker Development

Run the app and PostgreSQL together:

```bash
docker compose up --build
```

Then open:

```txt
http://localhost:3000
```

Generate Prisma Client inside the web container:

```bash
docker compose exec web pnpm prisma:generate
```

Create and apply a local migration:

```bash
docker compose exec web pnpm prisma:migrate
```

Stop containers:

```bash
docker compose down
```

Reset local database data:

```bash
docker compose down -v
```

## Git Policy

Commit application source, Prisma schema, Dockerfile, Compose config, and lockfiles.

Do not commit `.env`, real secrets, database volumes, `node_modules`, `.next`, or generated runtime data.
