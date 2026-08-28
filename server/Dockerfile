FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 9090

ENV PORT=9090

CMD ["node", "server.js"]
