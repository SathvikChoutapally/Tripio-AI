FROM node:20-alpine

WORKDIR /app

# Install curl for docker-compose healthchecks
RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
