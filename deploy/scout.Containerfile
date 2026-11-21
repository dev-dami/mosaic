# Scout in a container (Podman or Docker). Build from the repository root:
#   git archive HEAD | podman build -t mosaic-scout -f deploy/scout.Containerfile -
# Run it with deploy/mosaic-scout.container (Podman quadlet): 512 MB of memory in total with Caddy,
# a read-only root, and templates on a size-capped volume at /data. Only Caddy faces the internet.
FROM docker.io/oven/bun:1.4.4-debian
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json bun.lock ./
# playwright-core is a dev dependency; Scout needs it, so install everything, then the matching
# headless Chromium shell and its system libraries.
RUN bun install --frozen-lockfile \
 && bunx playwright-core install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* /root/.bun/install/cache /root/.cache
COPY agent ./agent
COPY providers ./providers
COPY src ./src
COPY vendor ./vendor
COPY tsconfig.json ./
ENV SCOUT_DIR=/data PORT=4108
USER bun
EXPOSE 4108 4110-4129
CMD ["bun", "agent/scout.ts"]
