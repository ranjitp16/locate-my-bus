# ── Build stage: install deps + produce the SPA bundle.
FROM node:22.22.1-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY web/client/package.json web/client/package-lock.json ./web/client/
RUN npm --prefix web/client install
COPY web/ ./web/
RUN npm --prefix web/client run build

# ── Runtime stage: only the Express app and its prod deps.
FROM node:22.22.1-bookworm-slim
WORKDIR /
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY web/ /web/
COPY --from=builder /app/web/public/dist /web/public/dist

EXPOSE 3000

CMD ["node", "./web/index.js"]
