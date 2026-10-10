# Spec 001 — Estructura base

Fase 0 · Reglas: — · Planificación §5, §7

## Objetivo

Dejar el repo listo para desarrollar: `api/` y `web/` funcionando, PostgreSQL 17 accesible, endpoint `/health`, scripts de desarrollo y CI local.

## Alcance

### api/

- Node 24, ESM (`"type": "module"`).
- Express 5 con `GET /health` → `200 { "status": "ok", "db": "up" }` si `sequelize.authenticate()` pasa; `503 { "status": "degraded", "db": "down" }` si no.
- Sequelize configurado con `src/config.js` leyendo `DATABASE_URL` (default `postgres://apuesta:apuesta@localhost:5432/apuesta`), `.sequelizerc` apuntando a `migrations/`, `src/models/`, `seeders/`.
- Socket.IO montado sobre el mismo `http.Server` (canal por sala se implementa en specs posteriores; aquí solo queda listo el servidor).
- Zod como dependencia para validación en specs futuras.
- `npm run dev` (node --watch), `npm test` (node:test), `npm run lint` (eslint).
- Test de `/health` con node:test + base de datos real (o `db: "down"` si no hay BD; el test levanta la app en un puerto efímero).

### web/

- Next.js App Router + TypeScript + Tailwind.
- TanStack Query instalado y con `QueryClientProvider` en el layout.
- `socket.io-client` instalado.
- Página `/` mínima que consulta `GET /health` de la API y muestra el estado.
- `npm run dev`, `npm run build`, `npm run lint`.

### Base de datos

- `scripts/db-up.sh`: `docker run` de `postgres:17-alpine` con usuario/password/bd `apuesta`, puerto 5432, nombre de contenedor `apuesta-pg`, volumen `apuesta-pgdata`. Idempotente (crea si no existe, arranca si está parado).
- `.env.example` en api/ y `.env` en `.gitignore`.

### Repo

- `AGENTS.md` en la raíz.
- `docs/api/openapi.yaml` con el esqueleto OpenAPI 3.1 y la operación `GET /health`.
- `scripts/ci-local.sh`: instala deps, corre lint + tests + build de api y web.
- `.github/workflows/ci.yml`: mismo chequeo en GitHub Actions con servicio postgres.

## Fuera de alcance

- Modelos de dominio, salas, rondas, autenticación, Socket.IO con lógica (specs 002+).

## Criterios de aceptación

1. `scripts/db-up.sh` levanta Postgres y `GET /health` responde `200` con `db: "up"`.
2. `cd api && npm test` pasa.
3. `cd web && npm run build` pasa.
4. `scripts/ci-local.sh` termina en verde.
5. `npm run dev` de api y web levantan ambos servidores y la web muestra el estado de salud.
