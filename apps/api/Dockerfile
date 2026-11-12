# syntax=docker/dockerfile:1.7
# Suskii API image (ADR-058). Build from the repository root:
#   docker build -f apps/api/Dockerfile --target runtime -t suskii-api .
#   docker build -f apps/api/Dockerfile --target migrate -t suskii-api-migrate .
# `runtime` serves the API with production dependencies only. `migrate` carries the Prisma CLI,
# schema and migrations and runs `prisma migrate deploy` once per release (a job or a Helm hook),
# never at start-up. Behind a TLS-intercepting proxy, pass its CA as a build secret:
#   docker build --secret id=ca,src=/path/to/ca.pem ...

# Base image pinned by digest; Dependabot proposes updates (docker ecosystem).
FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Only the API and the workspace packages it needs, with a pruned lockfile.
FROM base AS prune
COPY . .
RUN --mount=type=secret,id=ca,required=false \
    { [ ! -f /run/secrets/ca ] || export NODE_EXTRA_CA_CERTS=/run/secrets/ca; } && \
    pnpm dlx turbo@2.11.5 prune @suskii/api --docker

# Dependencies from the lockfile, without scripts (the schema is not here yet).
FROM base AS deps
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    { [ ! -f /run/secrets/ca ] || export NODE_EXTRA_CA_CERTS=/run/secrets/ca; } && \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY --from=prune /repo/out/full/ ./
# Allowed build scripts (Prisma engines), the Prisma client, then the API and its packages.
RUN --mount=type=secret,id=ca,required=false \
    { [ ! -f /run/secrets/ca ] || export NODE_EXTRA_CA_CERTS=/run/secrets/ca; } && \
    pnpm rebuild && pnpm --filter @suskii/api exec prisma generate && \
    pnpm exec turbo run build --filter=@suskii/api
# Every built output in the pruned workspace (the API and the packages it loads at runtime).
RUN for dir in apps/* packages/*; do \
      if [ -d "$dir/dist" ]; then mkdir -p "/built/$dir" && cp -R "$dir/dist" "/built/$dir/"; fi; \
    done

# Production dependencies only.
FROM base AS prod-deps
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    { [ ! -f /run/secrets/ca ] || export NODE_EXTRA_CA_CERTS=/run/secrets/ca; } && \
    pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
ENV NODE_ENV=production \
    API_PORT=4000
WORKDIR /app
# Manifests and every workspace's production node_modules, then the built output on top.
COPY --from=prod-deps --chown=root:root /repo ./
COPY --from=build --chown=root:root /built ./
WORKDIR /app/apps/api
# Files stay owned by root and read-only to the process; it runs as the image's `node` user.
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.API_PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
# Error reports name the commit the image was built from (CI passes REVISION).
ARG VERSION=dev
ARG REVISION=unknown
ENV SENTRY_RELEASE=${REVISION}
LABEL org.opencontainers.image.title="suskii-api" \
      org.opencontainers.image.source="https://github.com/Hubert24hrs/suskii_travels_and_tours" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

# The database step of a release: `prisma migrate deploy`, then the idempotent reference seed.
FROM build AS migrate
ENV NODE_ENV=production
WORKDIR /repo/apps/api
USER node
CMD ["node", "scripts/release-database.mjs"]
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="suskii-api-migrate" \
      org.opencontainers.image.source="https://github.com/Hubert24hrs/suskii_travels_and_tours" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
