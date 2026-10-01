# Production artifact; separate from the OFFLINE deploy/agents qualification image.
FROM ghcr.io/astral-sh/uv:0.12.19@sha256:04d046b13e60d6bcec73cbc5e1cad25d680dea90c8573340950a0ac2d1aef424 AS uv
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY deploy/agent-runner/.generated/hermes-agent hermes-agent
COPY deploy/agent-runner/.generated/manifest.json runner/manifest.json
COPY scripts/runtime-source-manifest.mjs scripts/
COPY services/agent-runner/image-metadata.mjs services/agent-runner/image-metadata.mjs
ENV UV_PYTHON_INSTALL_DIR=/opt/python UV_LINK_MODE=copy UV_NO_CACHE=1
RUN uv python install 3.12.13 \
 && uv sync --project /app/hermes-agent --locked --no-dev --extra acp --extra mcp --python 3.12.13 \
 && chmod -R a+rX /opt/python /app/hermes-agent/.venv \
 && node services/agent-runner/image-metadata.mjs

FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS proxy
WORKDIR /app
COPY services/agent-runner/proxy.mjs proxy.mjs
USER node
CMD ["node", "proxy.mjs"]

FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runner
WORKDIR /app
COPY --from=build /opt/python /opt/python
COPY --from=build /app/hermes-agent /app/hermes-agent
COPY --from=build /app/runner /app/runner
COPY deploy/agent-runner/.generated/providers.cjs runner/providers.cjs
COPY services/agent-runner/server.mjs runner/server.mjs
COPY scripts/pulsar-hermes-acp.py scripts/pulsar-hermes-turns.py scripts/pulsar-hermes-login.py scripts/
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
CMD ["node", "runner/server.mjs"]
