# This digest is the linux/amd64 manifest for Node 22 on Debian Bookworm slim.
FROM node:22-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.prod.json ./
COPY src ./src
RUN npx tsc --project tsconfig.prod.json

FROM node:22-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562 AS runtime

ENV NODE_ENV=production \
    PORT=3102
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    --cache=/tmp/npm-cache \
    && rm -rf /tmp/npm-cache

COPY --from=build --chown=node:node /app/dist ./dist

ARG OCI_VERSION=0.0.0
ARG OCI_REVISION=unknown
ARG OCI_RUN=local
LABEL org.opencontainers.image.title="Costa Apps MCP Server" \
      org.opencontainers.image.source="https://github.com/costaapps/ca_mcp" \
      org.opencontainers.image.version="${OCI_VERSION}" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.vendor="Costa Apps" \
      com.costaapps.github.run="${OCI_RUN}"

USER node
EXPOSE 3102
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3102/health/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["node", "dist/src/server.js"]
