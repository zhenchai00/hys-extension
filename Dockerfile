FROM node:18-alpine

WORKDIR /usr/src/app

# Install build dependencies
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN pnpm install --production

# Copy server and extensions
COPY src/server.js ./
COPY src/extensions ./extensions

EXPOSE 3500

CMD ["node", "server.js"]