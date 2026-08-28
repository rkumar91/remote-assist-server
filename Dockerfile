FROM node:20-alpine

WORKDIR /app

COPY server/ ./

RUN npm install --only=production

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
