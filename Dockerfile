# syntax=docker/dockerfile:1
#
# Closest Wins production image (adapter-node).
#
#   docker build -t closest-wins .
#   docker compose -f compose.prod.yaml --env-file .env.production up -d
#
# The default target is the app (non-root, migrations run on start). The `tools` target has
# the full source and dev dependencies for one-off jobs: downloading the map, seeding.

ARG NODE_VERSION=26
ARG PNPM_VERSION=12.19.0

# --- Base: Node + pnpm ----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# Node 25+ no longer ships corepack.
RUN npm install -g pnpm@${PNPM_VERSION} && pnpm --version
WORKDIR /app

# --- All dependencies (build + tools) -------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- Build ----------------------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm build

# --- Production dependencies only (sharp's native binary for this platform included) --------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

# --- Tools: map download, seeding (docker compose -f compose.prod.yaml run --rm tools …) ----------
FROM deps AS tools
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl unzip \
	&& apt-get clean
COPY . .
RUN mkdir -p /app/data/tools /data && chown -R node:node /app/data /data
ENV DATA_DIR=/data
USER node
CMD ["bash", "scripts/fetch-map.sh"]

# --- Runtime --------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS app
ENV NODE_ENV=production \
	PORT=3000 \
	HOST=0.0.0.0 \
	DATA_DIR=/data \
	BODY_SIZE_LIMIT=16M \
	SHUTDOWN_TIMEOUT=10
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --chown=node:node package.json ./
# Migrations (applied on start) and the seed script with what it imports.
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node scripts/migrate.ts scripts/seed.ts scripts/seed-data.ts ./scripts/
COPY --chown=node:node src/lib/server/db/schema.ts ./src/lib/server/db/schema.ts
# DATA_DIR (photos and the map file) lives on a volume; an empty named volume takes this
# directory's ownership, so the non-root user can write to it.
RUN mkdir -p /data/media /data/map && chown -R node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# exec: node gets SIGTERM directly (graceful shutdown ends live streams at once).
CMD ["sh", "-c", "node scripts/migrate.ts && exec node build"]
