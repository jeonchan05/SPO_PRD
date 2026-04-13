# syntax=docker/dockerfile:1.7

FROM public.ecr.aws/docker/library/node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM public.ecr.aws/docker/library/node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_DISABLE_BUILD_CHECKS=1
ENV NEXT_DISABLE_BUILD_CHECKS=${NEXT_DISABLE_BUILD_CHECKS}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache npm run build -- --no-lint

FROM public.ecr.aws/docker/library/node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs

EXPOSE 3000
CMD ["npm", "run", "start"]
