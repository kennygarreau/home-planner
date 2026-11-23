FROM node:26-slim

WORKDIR /app

# Pick up Debian security fixes published after the base image was built.
RUN apt-get update -y && apt-get upgrade -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Exact versions from package-lock.json; no dev tools (nodemon) in the image.
# package.json overrides `effect` to 3.22.5 because @prisma/config pins the
# ReDoS-affected 3.20.0 (GHSA-7589-6fvf-x4pw) — drop it once Prisma updates.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN npx prisma generate

# npm/npx are only needed to build. The npm bundled with Node ships its own
# vulnerable undici/brace-expansion, so remove it from the runtime image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Run as non-root
RUN useradd -r -u 1001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 3001

CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node src/index.js"]
