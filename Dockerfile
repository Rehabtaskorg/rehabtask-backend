# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev

# Stage 2: Production image
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup prisma ./prisma/
COPY --chown=appuser:appgroup src ./src/
COPY --chown=appuser:appgroup emails ./emails/
COPY --chown=appuser:appgroup prisma.config.js ./
COPY --chown=appuser:appgroup entrypoint.sh ./

RUN chmod +x entrypoint.sh

USER appuser
EXPOSE 8080
CMD ["sh", "entrypoint.sh"]
