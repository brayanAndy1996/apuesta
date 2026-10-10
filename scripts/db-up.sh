#!/usr/bin/env bash
# Levanta PostgreSQL 17 en Docker para desarrollo y tests.
# Idempotente: crea el contenedor si no existe, lo arranca si está parado.
set -euo pipefail

CONTAINER=apuesta-pg

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_USER=apuesta \
    -e POSTGRES_PASSWORD=apuesta \
    -e POSTGRES_DB=apuesta \
    -v apuesta-pgdata:/var/lib/postgresql/data \
    -p 5432:5432 \
    postgres:17-alpine >/dev/null
  echo "Contenedor $CONTAINER creado"
elif [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]; then
  docker start "$CONTAINER" >/dev/null
  echo "Contenedor $CONTAINER arrancado"
fi

# Espera a que Postgres acepte conexiones
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U apuesta -d apuesta >/dev/null 2>&1; then
    echo "PostgreSQL listo en localhost:5432 (bd: apuesta)"
    exit 0
  fi
  sleep 1
done

echo "PostgreSQL no respondió a tiempo" >&2
exit 1
