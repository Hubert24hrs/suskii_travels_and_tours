# syntax=docker/dockerfile:1.7
# Suskii agent image (ADR-058, ADR-101): the assistant's graphs behind one door, AGENT_PORT.
# It holds no connection to the API's tables and no route into the platform but the tool
# gateway. Build from the repository root:
#   docker build -f apps/agent/Dockerfile -t suskii-agent .
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
    pnpm dlx turbo@2.11.5 prune @suskii/agent --docker

FROM base AS build
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    { [ ! -f /run/secrets/ca ] || export NODE_EXTRA_CA_CERTS=/run/secrets/ca; } && \
    pnpm install --frozen-lockfile --ignore-scripts
COPY --from=prune /repo/out/full/ ./
RUN pnpm exec turbo run build --filter=@suskii/agent && \
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
    AGENT_PORT=4200
WORKDIR /app
COPY --from=prod-deps --chown=root:root /repo ./
COPY --from=build --chown=root:root /built ./
WORKDIR /app/apps/agent
USER node
EXPOSE 4200
# Ready, not only alive: the service is healthy once it can keep a conversation's working state
# (its own database role reads the checkpoint tables), so a deploy waits for exactly that.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.AGENT_PORT+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

# The image names the commit it was built from (CI passes REVISION).
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="suskii-agent" \
      org.opencontainers.image.source="https://github.com/Hubert24hrs/suskii_travels_and_tours" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
