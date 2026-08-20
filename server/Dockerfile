# SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
# SPDX-License-Identifier: AGPL-3.0-only

FROM node:22-alpine

ARG NODUS_VERSION=4.2.0
ARG NODUS_REVISION=unknown
LABEL org.opencontainers.image.title="Nodus Server" \
      org.opencontainers.image.description="Experimental self-hosted Nodus MCP server" \
      org.opencontainers.image.source="https://github.com/Drakonis96/nodus" \
      org.opencontainers.image.url="https://github.com/Drakonis96/nodus" \
      org.opencontainers.image.documentation="https://github.com/Drakonis96/nodus/blob/v4.2.0/server/README.md" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${NODUS_VERSION}" \
      org.opencontainers.image.revision="${NODUS_REVISION}" \
      app.nodus.stability="experimental"

WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY lib ./lib
COPY LICENSE SOURCE_CODE.md THIRD_PARTY_NOTICES.md ./

ENV NODUS_DATA_DIR=/data \
    NODUS_HOST=0.0.0.0 \
    NODUS_PORT=7443 \
    NODUS_SOURCE_URL=https://github.com/Drakonis96/nodus/tree/v4.2.0

RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 7443
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7443/healthz >/dev/null || exit 1
CMD ["node", "server.mjs"]
