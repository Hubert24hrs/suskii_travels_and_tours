# syntax=docker/dockerfile:1.7
# Suskii website image (ADR-058): the Next.js standalone server. Build from the repository root,
# once per environment, because Next.js inlines NEXT_PUBLIC_* values at build time:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://www.example.com -t suskii-web .
# Server-side settings (API_INTERNAL_URL, MOBILE_*) are runtime environment variables.
# Behind a TLS-intercepting proxy, pass its CA as a build secret: --secret id=ca,src=ca.pem

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

FROM base AS prune
COPY . .
RUN --mount=type=secret,id=ca,required=false \
    { [ ! -f /run/secrets/ca ] || export NODE_EXTRA_CA_CERTS=/run/secrets/ca; } && \
    pnpm dlx turbo@2.11.5 prune @suskii/web --docker

FROM base AS build
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    { [ ! -f /run/secrets/ca ] || export NODE_EXTRA_CA_CERTS=/run/secrets/ca; } && \
    pnpm install --frozen-lockfile --ignore-scripts
COPY --from=prune /repo/out/full/ ./
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_ADMIN_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_APPLE_SERVICES_ID
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ARG NEXT_PUBLIC_SENTRY_RELEASE
ARG NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE
ARG IMAGE_REMOTE_HOSTS
ENV NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL} \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY} \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID} \
    NEXT_PUBLIC_APPLE_SERVICES_ID=${NEXT_PUBLIC_APPLE_SERVICES_ID} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT} \
    NEXT_PUBLIC_SENTRY_RELEASE=${NEXT_PUBLIC_SENTRY_RELEASE} \
    NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE=${NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE} \
    IMAGE_REMOTE_HOSTS=${IMAGE_REMOTE_HOSTS}
# next/font fetches the Google Fonts files at build time, from Turbopack's native code, which
# reads the system trust store: a proxy CA goes there for this stage only (never the runtime).
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then \
      cat /run/secrets/ca >> /etc/ssl/certs/ca-certificates.crt && \
      export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt NODE_EXTRA_CA_CERTS=/run/secrets/ca; \
    fi && \
    pnpm exec turbo run build --filter=@suskii/web

FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=root:root /repo/apps/web/.next/standalone ./
COPY --from=build --chown=root:root /repo/apps/web/.next/static ./apps/web/.next/static
# The only writable path: Next.js's own cache (fetch cache, optimised images).
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/robots.txt').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="suskii-web" \
      org.opencontainers.image.source="https://github.com/Hubert24hrs/suskii_travels_and_tours" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
