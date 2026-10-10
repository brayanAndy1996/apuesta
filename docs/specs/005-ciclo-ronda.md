# Spec 005 — Ciclo de la ronda y temporizadores

Reglas cubiertas: R14, R15, R16, R17. Depende de la 003 (salas) y la 004 (dominio).

## Modelo

`rounds`: `id`, `room_id`, `seq` (número por sala), `state` (`ESPERANDO`, `CUENTA_REGRESIVA`, `PAUSADA`, `CERRADA`, `GIRANDO`, `LIQUIDADA`), `pool_red_centimos`, `pool_blue_centimos`, `countdown_ends_at`, `countdown_remaining_ms` (restante al pausar), `max_ends_at` (5 min desde la primera apuesta que entra), `max_expired` (la igualación ya se intentó una vez), `girando_ends_at`, `seed` (oculta hasta liquidar), `seed_hash` (publicado al abrir), `result_slot_id` (lo llena la 006), timestamps.

`bets`: `id`, `round_id`, `seq` (orden de llegada global por sala), `side` (red|blue), `amount_centimos`, `status` (`QUEUED` | `POOL`), `parent_bet_id` (apuesta partida al igualar), timestamps. Los campos del cajero (nombre, teléfono, método, operación) llegan en la 007.

## Máquina de estados (R14–R15)

- `ESPERANDO`: ronda abierta sin seguridad. Apuestas entran a la cola; las que cubren pasan a bolsa.
- Cada apuesta que **entra a bolsa** → si la ronda es segura: `CUENTA_REGRESIVA` con `countdown_ends_at = now + 60 s` (se reinicia en cada admisión). Si quedó insegura y venía de cuenta regresiva: `PAUSADA` guardando `countdown_remaining_ms`.
- `PAUSADA` → vuelve a `CUENTA_REGRESIVA` con el remanente cuando una admisión la hace segura de nuevo.
- `countdown_ends_at` vence → `CERRADA` → `GIRANDO` (`girando_ends_at = now + 7 s`) → `LIQUIDADA`.
- `max_ends_at` vence → `equalize()` del dominio: `spun=true` → `CERRADA` → `GIRANDO` → `LIQUIDADA`; `spun=false` → `max_expired = true` y la ronda queda abierta en `ESPERANDO`; se **reintenta equalize tras cada admisión nueva** (ADR-002).
- `LIQUIDADA` → se abre la siguiente ronda (`seq+1`, `ESPERANDO`, nuevo `seed`/`seed_hash`) y las apuestas `QUEUED` se mueven al inicio de su cola, conservando orden (R17).
- Apuestas registradas durante `CERRADA`/`GIRANDO` van a la ronda siguiente (la "abierta" es la que está en ESPERANDO/CUENTA_REGRESIVA/PAUSADA; si no existe abierta por estar en GIRANDO, se crea la siguiente al liquidar y las apuestas esperan ahí).

## Persistencia y concurrencia

- Toda mutación corre en transacción con `SELECT ... FOR UPDATE` sobre la ronda (planificación §6).
- Deadlines persistidos: un reinicio del servidor no pierde cuentas (el ticker las retoma vencidas o futuras).
- `ticker` cada 500 ms procesa rondas con deadline vencido: `processExpiredRounds(now)` es invocable en tests con `now` falso (sin esperas reales).
- El estado de bolsa/colas se deriva de `bets` + dominio `pool.js` en cada mutación; no hay estado en memoria.

## Eventos Socket.IO

Sala `room:<code>`: `round:update` con `{ seq, state, pools, queued, missing, countdownEndsAt, maxEndsAt, seedHash }`.

## Endpoints

- `GET /rooms/:code/round` — público: ronda abierta actual + bolsas, espera por color, `missing` por color, deadlines, `seedHash`.
- `POST /rooms/:code/bets` — cajero de la sala o admin: `{ side, amountCentimos }`. **Provisional** para ejercitar el ciclo; la 007 lo sustituye por el registro completo (pago verificado, método, operación).

## Pruebas (test/rounds.test.js)

- Admisión mueve QUEUED→POOL y actualiza bolsas persistidas.
- Cuenta regresiva se reinicia con cada admisión; pausa y reanuda con remanente.
- Vencimiento a 60 s cierra → gira → liquida → abre la siguiente ronda y arrastra la cola en orden.
- A los 5 min con desbalance se iguala (apuesta partida arrastrada) y gira.
- `processExpiredRounds` con `now` falso: sin sleeps largos.
- Concurrencia: la mutación bloquea la fila (FOR UPDATE) — verificable por prueba de humo, no exhaustiva.
