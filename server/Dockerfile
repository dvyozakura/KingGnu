# Node 版対戦サーバー（Fly.io / Render / Railway / VPS 等の常駐環境向け）
# ビルド: docker build -f server/Dockerfile -t kinggnu-server .
FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
COPY shared ./shared
COPY server ./server
COPY client/package.json ./client/package.json
COPY tsconfig.base.json ./
RUN npm install --no-audit --no-fund -w server -w shared --include-workspace-root \
 && npm run build -w server

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /app/server/dist ./dist
RUN npm install --no-audit --no-fund ws@8
EXPOSE 8787
CMD ["node", "dist/server.mjs"]
