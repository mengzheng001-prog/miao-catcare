# 备用 Docker 镜像（Render 默认会用 Node runtime，不一定需要 Docker）。
# 用途：本地复现生产模式 / 部署到 Railway / Fly.io / 自托管服务器。

FROM node:20-alpine AS builder
WORKDIR /app

# 装依赖（含 tsx，因为生产 runtime 需要）
COPY package*.json ./
RUN npm install --include=prod

# 拷贝源码 + Vite build 前端
COPY . .
RUN npm run build

# 第二阶段：精简运行镜像
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# 只拷必要的运行文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["npm", "run", "start"]
