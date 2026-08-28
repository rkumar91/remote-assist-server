FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --only=production

COPY server/ ./server/

CMD ["node", "server/server.js"]
