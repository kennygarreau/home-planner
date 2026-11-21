FROM node:26-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN chmod -R 755 /app/dist


# Wi-Fi survey agent AppImage, served at /downloads/. Source comes from the
# `wifi_survey` additional build context (see docker-compose.yml).
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS wifi-agent
RUN apt-get update && apt-get install -y --no-install-recommends curl file \
    && rm -rf /var/lib/apt/lists/*
COPY --from=wifi_survey packaging/appimage/ /pkg/
RUN /pkg/build.sh fetch /dl
COPY --from=wifi_survey . /src
RUN /pkg/build.sh build /src /out /dl


FROM nginx:1.30-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=wifi-agent /out/ /usr/share/nginx/html/downloads/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
