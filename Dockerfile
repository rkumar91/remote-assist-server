FROM node:20-alpine

WORKDIR /app

COPY server/ ./

RUN npm install --only=production

ENV PORT=9090
EXPOSE 9090

CMD ["npm", "start"]
