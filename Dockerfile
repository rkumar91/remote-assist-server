FROM node:20-alpine

WORKDIR /app

COPY server/ ./

RUN npm install --only=production

EXPOSE 8080 9090 3000

CMD ["node", "server.js"]
