# CONTINUAR — contexto para retomar sin historial

## Qué es esto

Ruleta Rápida: web de apuestas rojo/azul con bolsa segura (demo, dinero
ficticio). Fuente de verdad: `docs/planificacion.md` (R1–R31, no negociables).
Metodología: una spec por PR, escrita antes del código; dominio puro en
`api/src/domain/` probado con fast-check.

## Dónde está el código

- Monorepo `brayanAndy1996/apuesta`: `api/` (Express 5 + Sequelize + Postgres 17
  + Socket.IO + Zod) y `web/` (Next.js App Router + Tailwind + TanStack Query).
- Contrato HTTP: `docs/api/openapi.yaml`. Specs: `docs/specs/NNN-*.md`.
- Decisiones: `docs/decisions/NNN-*.md` (ADR-001 slots por defecto,
  ADR-002 admisión R11 literal + reintento de igualación).

## Estado (al terminar spec 008 — con metodología SDD+TDD completa)

- Liquidación: `domain/settlement.js` — `settle(round, slots, poolBets)`
  asigna premios por apuesta en bolsa: ganadores de su color cobran
  `floor(amount × multiplier/100)` (R2, redondeo a favor de la casa),
  perdedores y QUEUED (arrastrada) cobran 0. Invariante R26 probada con
  fast-check: `collected = paid + kept` y la casa nunca queda negativa.
- Ciclo: en `GIRANDO→LIQUIDADA` se guarda `payoutCentimos` por apuesta y
  `paidOperationNumber=null`. Rescue: si `resultSlotId` faltara se deriva de
  la semilla (idempotente).
- Endpoints cajero/admin: `GET /rooms/:code/winners?seq=` (última LIQUIDADA,
  lista PENDIENTE/PAGADA), `POST /rooms/:code/bets/:id/pay` (nº operación,
  409 si ya pagada, FOR UPDATE), `GET /rooms/:code/rounds/:seq/accounting`
  (collected/paid/kept por color).
- UI `/cajero`: sección "Ganadores por pagar — ronda N" con botón
  "Marcar pagada" (prompt del nº de operación).
- adversarial-tester (pasada documentada aquí): sin hallazgos críticos/altos.
  Corregidos 2 bajos: `seq` NaN → 400 en `/winners` y `/rounds/:seq/accounting`.
  Verificado: doble pago concurrente (lock), pago pre-liquidación (409),
  QUEUED/ANULADA no cobran, premio solo del color ganador, roomId ajeno → 404.
- Gotcha: `FOR UPDATE` con include (outer join) falla en Postgres → bloquear
  la fila sin include y traer la asociación aparte.

## Estado (al terminar spec 007)

- `bets` extendida: player_name, phone, method (yape|plin), operation_number
  (único por método, índice parcial), payment_verified, cashier_id,
  annul_reason, refund_operation_number; `side` nullable = bandeja "Sin color"
  (fuera de la cola del dominio); status += ANULADA, DEVUELTA.
- `roundService`: placeBet acepta el payload completo y parte el excedente
  sobre `maxBetCentimos` en otra QUEUED del mismo color (R21). `assignBetSide`,
  `annulBet` (descuenta del pool y puede pausar, solo ronda abierta),
  `refundBet` (solo QUEUED), `roundBetsView` para la bandeja.
- `parseBetMessage` (`lib/betMessage.js`) autocompleta desde el mensaje R18.
- `/auth/me` devuelve `room` al cajero. UI `/cajero`: formulario con pegado,
  bandeja sin color, acciones anular/devolver.
- Gotcha: los ENUM de Postgres no crecen con changeColumn → usar
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.

## Estado (al terminar spec 006)

- Sorteo: `api/src/domain/draw.js` — `pos = BigInt("0x"+seed) % 100` sobre el
  orden canónico de casillas (red por multiplier asc, luego blue por asc).
  `closeAndSpin` guarda `result_slot_id` en la misma transacción del cierre
  (R9) y nunca resortea (idempotente).
- `GET /rooms/:code/round` devuelve `result` (casilla) desde GIRANDO; el
  historial público `GET /rooms/:code/rounds?limit=N` expone `seed` solo en
  rondas `LIQUIDADA` (verificable: `sha256(seed) === seedHash`).

## Estado (al terminar spec 005)

- Tablas: `users`, `rooms`, `room_slots`, `rounds`, `bets`.
- `api/src/services/roundService.js`: `placeBet` (transacción FOR UPDATE,
  crea/usa la ronda abierta), `processExpiredRounds(now)` (ticker 500 ms en
  `index.js`; testeable con `now` falso), `currentRoundView`.
- Máquina de estados con **deadlines persistidos**: `countdown_ends_at`
  (60 s, se reinicia por admisión), `max_ends_at` (5 min → equalize →
  `max_expired` + reintento si no gira), `girando_ends_at` (7 s).
- Socket.IO: cliente emite `join:room <CODE>`; servidor emite `round:update`
  en `room:<CODE>` tras cada transición.
- Endpoints: `GET /rooms/:code/round` (público) y `POST /rooms/:code/bets`
  (cajero asignado o admin — **provisional**, la 007 lo reemplaza).
- Al liquidar, las apuestas `QUEUED` se arrastran a la ronda siguiente
  conservando `seq` global por sala.

## Lo que sigue (spec 006)

- Sorteo verificable: al cerrar, elegir slot con la semilla (ya persistida con
  su hash publicado), guardar `result_slot_id`, y liquidar apuestas POOL con
  `payout = floor(amount × mult / 100)` (R2).
- Revelar `seed` al liquidar (el campo ya existe y queda legible).

## Gotchas

- Node 24 via nvm: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`.
- BD: `./scripts/db-up.sh` (Docker `apuesta-pg`); tests usan `apuesta_test`
  (`NODE_ENV=test`); migrar ambas BDs tras nuevas migraciones.
- Tests serializados: `node --test --test-concurrency=1` (comparten la BD).
- Los pesos por defecto se normalizaron a 5/10/20/10/5 por color (ADR-001):
  la tabla R7 del documento suma 90 %.
- Dinero siempre en céntimos enteros; multiplicadores en centésimas (170=1.70).
