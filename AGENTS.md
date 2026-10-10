# AGENTS.md — Ruleta Rápida

Guía para agentes de IA que trabajan en este repositorio. La fuente de verdad del producto es `docs/planificacion.md`; cada cambio se implementa siguiendo una spec en `docs/specs/`.

## Estructura

```
apuesta/
├── AGENTS.md            ← este archivo
├── docs/
│   ├── planificacion.md ← visión, actores, reglas R1–R31 (NO NEGOCIABLES)
│   ├── specs/           ← una spec por fase, escrita antes del código
│   └── api/openapi.yaml ← contrato HTTP entre api y web
├── api/                 Node 24 ESM · Express 5 · Sequelize + migraciones · PostgreSQL 17 · Socket.IO · Zod
├── web/                 Next.js (App Router) · TypeScript · Tailwind · TanStack Query · socket.io-client
└── scripts/             utilidades de desarrollo y CI local
```

## Cómo trabajar

1. Lee `docs/planificacion.md` y la spec correspondiente en `docs/specs/` antes de escribir código.
2. Respeta las reglas de negocio R1–R31 literalmente; si algo contradice la spec, la spec manda y se documenta la decisión.
3. El dominio (`api/src/domain/`) es puro: sin Sequelize, sin Express, sin red. Se prueba con fast-check.
4. Dinero: **céntimos enteros** (nunca float). Multiplicadores: enteros en centésimas (1.70 = 170).
5. Zona horaria del producto: `America/Lima`.

## Comandos

```bash
scripts/db-up.sh          # levanta PostgreSQL 17 en Docker (apuesta-pg, puerto 5432)
cd api && npm install && npm run dev      # API en :4000, GET /health
cd web && npm install && npm run dev      # Web en :3000
scripts/ci-local.sh       # lint + tests + build de api y web
```

## Convenciones

- Código en inglés, UI en español (Perú). Glosario español→código en planificacion.md §3.
- Ramas: `devin/<nº-spec>-<slug>`. Un PR por spec.
- No commitear secretos; la config va en `.env` (ver `api/.env.example`).
