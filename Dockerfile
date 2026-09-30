# syntax=docker/dockerfile:1.7
# One image for every Plandit process (web, api, worker, mocks, migrations): the monorepo installed and built once.
# docker-compose.prod.yml starts it with a different command per service.
# The full (not -slim) image: it already has the OpenSSL library Prisma's migration engine needs, so no apt step.
FROM node:24-bookworm

WORKDIR /app
RUN corepack enable

# Dependencies first, so a code change doesn't reinstall them. postinstall generates the Prisma client from the schema.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mocks/package.json apps/mocks/
COPY packages/database/package.json packages/database/prisma.config.ts packages/database/
COPY packages/database/prisma packages/database/prisma
COPY packages/shared/package.json packages/shared/
# The optional extra_ca secret is only for building behind a TLS-inspecting proxy; a normal server passes none.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi && pnpm install --frozen-lockfile

COPY . .
# Values the browser needs are baked into the web build.
ARG NEXT_PUBLIC_DEMO_EMAIL=""
ARG NEXT_PUBLIC_DEMO_PASSWORD=""
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @plandit/api build && pnpm --filter @plandit/web build

ENV NODE_ENV=production
