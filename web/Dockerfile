FROM node:22.22.1-bookworm-slim

WORKDIR /
COPY web/ /web/
COPY package.json .
COPY package-lock.json .

RUN npm install --omit=dev

EXPOSE 3000

CMD ["node", "./web/index.js"]
