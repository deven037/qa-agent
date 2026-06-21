FROM node:20-slim AS base

# Install system dependencies required by Playwright's Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    openssl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    --no-install-recommends && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- deps stage ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Download Playwright's own Chromium (correct version for this playwright release)
RUN npx playwright install chromium

# --- build stage ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXTAUTH_SECRET
ARG AUTH_SECRET
ARG NEXTAUTH_URL
ARG AUTH_URL
ARG MONGODB_URI
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV AUTH_SECRET=$AUTH_SECRET
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV AUTH_URL=$AUTH_URL
ENV MONGODB_URI=$MONGODB_URI

RUN npm run build

# --- runner stage ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--tls-min-v1.2"
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy lib/prompts (markdown files read at runtime)
COPY --from=builder /app/lib/prompts ./lib/prompts

# Copy playwright and its downloaded Chromium browser to a fixed path
COPY --from=deps /app/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=deps /app/node_modules/@playwright ./node_modules/@playwright
COPY --from=deps /app/node_modules/playwright ./node_modules/playwright
COPY --from=deps /root/.cache/ms-playwright /ms-playwright

# Tell Playwright where to find browsers regardless of user home dir
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN chown -R nextjs:nodejs /ms-playwright

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
