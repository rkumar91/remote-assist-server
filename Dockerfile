FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --only=production

COPY server/ ./server/

EXPOSE 9090

ENV PORT=9090

CMD ["node", "server/server.js"]
