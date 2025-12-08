FROM node:18-alpine

WORKDIR /usr/src/app

# Install pnpm
RUN corepack enable pnpm && corepack install -g pnpm@latest

# Install build dependencies
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN pnpm install --production

# Copy server and extensions
COPY src/server.js ./
COPY src/extensions ./src/extensions

EXPOSE 3500

CMD ["node", "server.js"]