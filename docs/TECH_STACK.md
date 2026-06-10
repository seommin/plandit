# Technical Stack

Baseline date: 2026-06-09.

| Area | Choice | Version |
|---|---:|---:|
| Runtime | Node.js LTS | `24.16.0` |
| Package manager | pnpm | `11.5.2` |
| Web framework | Next.js App Router | `16.2.7` |
| Backend framework | NestJS | `11.1.9` |
| UI runtime | React / React DOM | `19.2.7` |
| Language | TypeScript | `6.0.3` |
| Database | PostgreSQL | `18.4` |
| ORM | Prisma ORM | `7.4.0` |
| Auth | Auth.js / NextAuth | `5.0.0-beta.31` |
| Auth adapter | `@auth/prisma-adapter` | `2.9.1` |
| Styling | Tailwind CSS | `4.3.0` |

## Direction

The product starts as a web-first SaaS calendar with a data model that can later support mobile apps and home / lock screen widgets. The UI direction is modern, calm, and product-oriented: dense enough for repeated daily use, polished enough for a brand launch.

## Application Boundaries

- `apps/web`: Next.js web app for UI, Auth.js session handling, and server-side proxy routes.
- `apps/api`: NestJS backend API for calendars, events, event sharing, and future integrations.
- `packages/database`: Prisma schema, migrations, generated clients, and database connection helpers.
- `packages/shared`: Shared validation schemas and product constants used by web and API.

The preferred runtime flow for product data is:

```txt
Next.js web -> NestJS API -> Prisma -> PostgreSQL
```

Auth.js currently remains in `apps/web` so the existing login/session flow stays stable. The NestJS API is protected through an internal API secret and receives the authenticated user context from the web server.
