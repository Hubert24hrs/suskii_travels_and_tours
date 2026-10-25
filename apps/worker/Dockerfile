# syntax=docker/dockerfile:1.7
# Suskii worker image (ADR-058): BullMQ jobs plus the health server on WORKER_HEALTH_PORT.
# Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t suskii-worker .
# Behind a TLS-intercepting proxy, pass its CA as a build secret: --secret id=ca,src=ca.pem

# Base image pinned by digest; Dependabot proposes updates (docker ecosystem).
FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS prune
COPY . .
RUN --mount=type=secret,id=ca,required=false \
    { [ ! -f /run/secrets/ca ] || export NODE_EXTRA_CA_CERTS=/run/secrets/ca; } && \
    pnpm dlx turbo@2.11.5 prune @suskii/worker --docker

FROM base AS build
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    { [ ! -f /run/secrets/ca ] || export NODE_EXTRA_CA_CERTS=/run/secrets/ca; } && \
    pnpm install --frozen-lockfile --ignore-scripts
COPY --from=prune /repo/out/full/ ./
RUN pnpm exec turbo run build --filter=@suskii/worker && \
    for dir in apps/* packages/*; do \
      if [ -d "$dir/dist" ]; then mkdir -p "/built/$dir" && cp -R "$dir/dist" "/built/$dir/"; fi; \
    done

FROM base AS prod-deps
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    { [ ! -f /run/secrets/ca ] || export NODE_EXTRA_CA_CERTS=/run/secrets/ca; } && \
    pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
ENV NODE_ENV=production \
    WORKER_HEALTH_PORT=4100
WORKDIR /app
COPY --from=prod-deps --chown=root:root /repo ./
COPY --from=build --chown=root:root /built ./
WORKDIR /app/apps/worker
USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.WORKER_HEALTH_PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="suskii-worker" \
      org.opencontainers.image.source="https://github.com/Hubert24hrs/suskii_travels_and_tours" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
