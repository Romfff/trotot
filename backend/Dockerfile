FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# Build-time placeholder only; generate does not connect to a database.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build

FROM build AS checks
COPY test ./test
COPY scripts ./scripts
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm test && npm run lint

FROM build AS migration
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM build AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS runtime
COPY --from=production-dependencies --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY --from=build --chown=node:node /app/backend/package.json ./package.json
USER node
EXPOSE 5000
CMD ["node", "dist/main.js"]
