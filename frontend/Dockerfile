FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && node -e "require('lightningcss'); require('@tailwindcss/oxide')"
FROM dependencies AS build
ARG NEXT_PUBLIC_PAYMENT_REALTIME_URL
ENV NEXT_PUBLIC_PAYMENT_REALTIME_URL=$NEXT_PUBLIC_PAYMENT_REALTIME_URL
COPY next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs ./
COPY src ./src
COPY public ./public
ENV NEXT_TELEMETRY_DISABLED=1
RUN BUILD_STANDALONE=true npm run build

FROM build AS checks
COPY tests ./tests
COPY vitest.config.mts ./
RUN npm test && npm run lint && npm run typecheck

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
