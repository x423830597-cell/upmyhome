# AI改我家 demo - 生产镜像（常规 next build + next start，不改项目配置）
FROM node:24-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
# 数据目录：SQLite + 上传/分割/结果图片，部署时挂 persistent volume
RUN mkdir -p /app/data /app/public/uploads /app/public/masks /app/public/edits \
  && chown -R nextjs:nodejs /app/data /app/public
VOLUME ["/app/data", "/app/public/uploads", "/app/public/masks", "/app/public/edits"]
USER nextjs
EXPOSE 3000
CMD ["npm", "start"]
