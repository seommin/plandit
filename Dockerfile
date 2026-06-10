FROM node:24.16.0-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.5.2 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS dev

COPY . .
EXPOSE 3000 4000
CMD ["pnpm", "dev"]

FROM deps AS builder

COPY . .
ENV DATABASE_URL="postgresql://plandit:plandit@postgres:5432/plandit"
ENV DIRECT_URL="postgresql://plandit:plandit@postgres:5432/plandit"
ENV API_INTERNAL_SECRET="build-time-secret"
ENV API_INTERNAL_URL="http://api:4000"
RUN pnpm build

FROM base AS runner

ENV NODE_ENV="production"

COPY --from=builder /app ./

EXPOSE 3000 4000
CMD ["pnpm", "start:web"]
