FROM node:20-alpine

WORKDIR /app/server

COPY server/package*.json ./
RUN npm install --only=production

COPY server/ ./

ENV PORT=9090
EXPOSE 9090

CMD ["node", "server.js"]
