FROM node:22-alpine

LABEL org.opencontainers.image.title="Nodus Server" \
      org.opencontainers.image.description="Experimental self-hosted Nodus MCP server" \
      org.opencontainers.image.source="https://github.com/Drakonis96/nodus" \
      app.nodus.stability="experimental"

WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY lib ./lib

ENV NODUS_DATA_DIR=/data \
    NODUS_HOST=0.0.0.0 \
    NODUS_PORT=7443

RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 7443
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7443/healthz >/dev/null || exit 1
CMD ["node", "server.mjs"]
