# Spec 009 — Pantalla pública en vivo (R13, R27)

## Objetivo

La página pública de una sala muestra la ronda en vivo — bolsa por color, cola
en espera, bloqueos, cuenta regresiva, giro con la casilla ganadora — y la lista
pública de apuestas con datos del jugador enmascarados, todo actualizándose en
tiempo real vía Socket.IO.

## Alcance

### API

- `GET /rooms/:code/public-bets` (público): apuestas de la ronda abierta
  (`QUEUED`, `POOL` y "sin color" pendientes; excluye `ANULADA`/`DEVUELTA`),
  más reciente primero. Por apuesta: `displayName`, `maskedPhone`, `side`
  (nullable), `amountCentimos`, `createdAt`, `winRangeCentimos {min,max}`
  (null si no tiene color todavía).
- Enmascarado (R27) en `api/src/lib/mask.js` (puro):
  - `publicName("Juan Pérez García")` → `"Juan P."` (primer nombre + inicial
    del primer apellido; si hay un solo nombre, solo ese).
  - `maskPhone("999 888 777")` → `"*** *** 777"` (solo últimos 3 dígitos).
  - `winRangeCentimos(amount, slots, side)` → `{min, max}` =
    `floor(amount × multiplicador/100)` con el mín/máx multiplicador de su
    color — "gana entre S/ X y S/ Y" (R27).
- `currentRoundView` (usado por `GET /rooms/:code/round`) expone además
  `blocked: {red, blue}`: `true` si hay cola esperando en ese color (la apuesta
  de adelante no puede entrar) y `missing` ya dice cuánto falta del otro color.
- Socket.IO: `round:update` ya emite estado/pools/deadlines/`resultSlotId`;
  el front re-consulta `/round` y `/public-bets` en cada evento (misma fuente
  de verdad, sin payload duplicado).

### Web — `/sala/[code]` (público, sin login)

- Bolsa por color (rojo/azul), "en espera" por color, y por cada color
  bloqueado: mensaje "Falta S/ X del otro color" (min–max).
- Cuenta regresiva visible en `CUENTA_REGRESIVA`; indicador de `PAUSADA`
  ("Esperando igualación"); animación de giro en `GIRANDO` que termina en la
  casilla `result` (multiplicador + color); resultado persistente en
  `LIQUIDADA` hasta que abre la siguiente.
- Lista pública de apuestas con `displayName`, `maskedPhone`, monto, color,
  hora (America/Lima) y "gana entre S/ min y S/ max".
- `socket.io-client` → `emit("join:room", code)`; cada `round:update`
  invalida las queries de ronda y lista.

## Fuera de alcance

QR/WhatsApp para armar la apuesta (spec 010), reglas/calculadora/verificador
(011), reportes (012), simulador (013).

## Criterios de aceptación

- AC-01 `publicName`: "Juan Pérez" → "Juan P."; "María" → "María"; null → null.
- AC-02 `maskPhone`: "999888777" → "*** *** 777"; "51 999 888 777" → "*** *** 777"; null → null.
- AC-03 `GET /public-bets` lista solo la ronda abierta, enmascara nombre/teléfono
  y no expone `operationNumber`, `paymentVerified` ni datos del cajero.
- AC-04 `winRangeCentimos`: apuesta roja de S/10 con multiplicadores 150–190 →
  `{min:1500, max:1900}`; `side=null` → `null`.
- AC-05 ANULADA/DEVUELTA no aparecen; la bandeja "sin color" aparece con
  `side=null`, `winRangeCentimos=null`.
- AC-06 `blocked.red=true` cuando hay cola roja esperando y `missing.red` indica
  lo que falta del azul; sin cola → `blocked=false` y `missing=null`.

## Verificación

Tests `api/test/publicBets.test.js` + `api/test/mask.test.js`; `web` lint+build;
smoke: abrir `/sala/GENERAL`, registrar apuestas por API y ver la lista/bolsas
actualizarse sin recargar.
