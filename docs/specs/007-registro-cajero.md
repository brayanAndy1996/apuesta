# Spec 007 — Registro rápido de apuestas del cajero (R19–R24)

## Alcance

El cajero registra en su pantalla las apuestas cuyo pago ya verificó en su app
Yape/Plin: pega el mensaje de WhatsApp para autocompletar, elige método, escribe
el número de operación y marca "pago verificado". Incluye la bandeja **"Sin
color"**, la anulación antes del cierre y la devolución de apuestas en espera.

Reemplaza el `POST /rooms/:code/bets` provisional de la spec 005. La pantalla
pública del jugador llega en la 009/010 y los ganadores por pagar en la 008.

## Modelo — extensión de `bets`

Nuevas columnas:

- `player_name` text, null (obligatorio al registrar con color)
- `phone` text, null
- `method` enum `yape|plin`, null (obligatorio al registrar)
- `operation_number` text, null — **único por método** (R20): índice único
  parcial `(method, operation_number)` donde no es null
- `payment_verified` bool default false — el registro exige `true` (R19)
- `cashier_id` uuid → users
- `annul_reason` text, null; `refund_operation_number` text, null
- `side` pasa a **nullable**: `null` = bandeja "Sin color" (R22)
- `status` amplía: `QUEUED | POOL | ANULADA | DEVUELTA`

Las apuestas "sin color" viven en la ronda abierta pero **no entran a la cola del
dominio** (se excluyen de `loadPoolState` mientras `side IS NULL`). Al asignar
color pasan a cola normal y se drena.

## Dominio/lib

`api/src/lib/betMessage.js` — `parseBetMessage(text)`: heurística sin
dependencias que extrae `{ side?, amountCentimos?, playerName?, phone? }` del
formato R18 `APUESTA · Sala X · ROJO|AZUL · S/ 10.00 · Nombre · 9xxxxxxxx` y de
textos aproximados (busca "rojo|azul", monto con S/, teléfono de 9 dígitos).
Documentado como ayuda: el cajero siempre puede corregir.

## Endpoints (cajero asignado a la sala; admin permitido)

- `POST /rooms/:code/bets` — `{ side? , amountCentimos, playerName, phone,
  method, operationNumber, paymentVerified: true }`. Valida rango contra
  `maxBetCentimos`: si excede, registra `max` y crea **otra apuesta QUEUED del
  mismo color por el excedente** (R21). Sin `side` → bandeja sin color.
- `PATCH /rooms/:code/bets/:id` — `{ side }`: asigna color a una apuesta "sin
  color" → entra a la cola y drena.
- `POST /rooms/:code/bets/:id/annul` — `{ reason }` (R23): solo mientras la
  ronda esté abierta (ESPERANDO/CUENTA_REGRESIVA/PAUSADA). Si estaba en POOL se
  descuenta de la bolsa y se reevalúa seguridad (puede pasar a PAUSADA).
- `POST /rooms/:code/bets/:id/refund` — `{ refundOperationNumber }` (R24): solo
  `QUEUED`; registra el nº de la devolución.
- `GET /rooms/:code/bets` — lista de la ronda abierta con datos del jugador,
  estado y bandeja (`sin_color` = side null).

## UI `/cajero`

- Formulario: textarea para pegar mensaje → autocompleta campos; color, monto
  S/, nombre, teléfono, método, nº operación, checkbox "pago verificado"
  (obligatorio).
- Debajo: apuestas de la ronda (pool/espera), bandeja "Sin color" con selector
  de color, acciones anular/devolver con confirmación.

## Criterios de aceptación

- AC-01: registro completo crea apuesta QUEUED→POOL con datos de pago.
- AC-02: `operationNumber` duplicado por método → 409; distinto método sí pasa.
- AC-03: `paymentVerified=false` → 422.
- AC-04: pago > máximo → dos apuestas (tope + excedente en cola) del mismo color.
- AC-05: sin color → no cuenta en colas/bolsas hasta `PATCH` con `side`.
- AC-06: anular POOL descuenta la bolsa y puede pausar la ronda; anular tras
  CERRADA → 409; requiere motivo.
- AC-07: devolver solo QUEUED; registra `refundOperationNumber`; la cola lo
  refleja fuera.
- AC-08: `parseBetMessage` extrae los 4 campos del formato R18 y no rompe con
  texto libre.
