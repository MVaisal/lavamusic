# Stage 1: Build TypeScript
FROM node:23-alpine AS builder

WORKDIR /opt/lavamusic

# Install pnpm and build dependencies
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    apk add --no-cache python3 make g++

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies using pnpm
RUN pnpm install --frozen-lockfile

# Copy remaining source files
COPY . .

# Build
RUN pnpm run build

# Stage 2: Production image
FROM node:23-alpine

ENV NODE_ENV=production \
    PORT=80 \
    TZ=UTC

WORKDIR /opt/lavamusic

# Install pnpm and runtime dependencies
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    apk add --no-cache --virtual .runtime-deps \
    openssl \
    ca-certificates \
    tzdata \
    curl


# Copy package files for production dependencies
COPY --from=builder --chown=node:node /opt/lavamusic/package.json /opt/lavamusic/pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built files from builder
COPY --from=builder --chown=node:node /opt/lavamusic/dist ./dist
COPY --from=builder --chown=node:node /opt/lavamusic/src/utils/LavaLogo.txt ./src/utils/LavaLogo.txt
COPY --from=builder --chown=node:node /opt/lavamusic/locales ./locales
COPY --chown=node:node entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Create non-root user and set permissions
RUN chown -R node:node /opt/lavamusic
USER node


# Metadata labels
LABEL maintainer="appujet <sdipedit@gmail.com>" \
      org.opencontainers.image.title="LavaMusic" \
      org.opencontainers.image.description="LavaMusic - Advanced Music Bot" \
      org.opencontainers.image.source="https://github.com/botxlab/lavamusic" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/index.js"]
