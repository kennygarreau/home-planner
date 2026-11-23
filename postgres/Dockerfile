# Official image plus Alpine package updates released since it was last built.
# Same PostgreSQL major (16), same data volume. Rebuild with `docker compose
# build --pull db` to follow upstream.
FROM postgres:16-alpine
RUN apk upgrade --no-cache
