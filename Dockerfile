# Node major and Alpine release are pinned, the Node minor and patch float so that every build picks up the current security release. Never node:24-alpine: that tag swaps the Alpine release underneath and breaks native modules and Prisma's OpenSSL. Bump the Alpine release explicitly, and before the Docker Hub image stops being rebuilt for it (only the two latest Alpine releases are).
ARG NODE_IMAGE=node:24-alpine3.23

# ---- builder: one install, Prisma client, Next.js standalone build, then pruned to the runtime node_modules ----
# A single stage on purpose: two independent stages would run their `npm ci` and the build in parallel and double the peak memory of the build.
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
# Only used when no better-sqlite3 prebuild matches the platform.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
# The postinstall hook runs `prisma generate`, which loads prisma.config.ts and lib/paths.ts.
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY lib/paths.ts ./lib/paths.ts
RUN npm ci
COPY . .
# No --max-old-space-size here: Next strips it from the worker that runs the build, it would cap nothing.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Runtime node_modules, Prisma CLI and tsx included (see package.json): drop the dev packages in place, no second install.
RUN npm prune --omit=dev && npm cache clean --force

# ---- runner ----
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
# git: the engine. openssl: Prisma on Alpine. dumb-init, su-exec, shadow: signal handling and PUID/PGID in the entrypoint.
RUN apk add --no-cache git openssl ca-certificates dumb-init su-exec shadow
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PUID=1000 \
    PGID=1000
# Standalone server with its traced node_modules, then the full runtime node_modules on top (a superset: Prisma CLI, tsx, generated client).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next/static ./.next/static
# The standalone output leaves public/ out as well: without this the sidebar logo is a 404.
COPY --from=builder /app/public ./public
# Migrations, CLI config (resolves DATA_DIR through lib/paths.ts), version shown by the entrypoint.
COPY prisma ./prisma
COPY prisma.config.ts package.json tsconfig.json ./
# Uploaded to every site at dump time, read from <cwd>/helpers.
COPY helpers ./helpers
# Operator scripts (import-config, reset-password) run through tsx and import lib/, including the generated client.
COPY scripts ./scripts
COPY lib ./lib
COPY --from=builder /app/lib/generated ./lib/generated
COPY docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh && mkdir -p /data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:3000/api/health', (r) => { r.resume(); process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["./docker-entrypoint.sh"]
