# Spec 008 — Liquidación y bandejas (R25–R26)

## Alcance

Al liquidar una ronda (`GIRANDO → LIQUIDADA`) se calcula el premio de cada
apuesta en bolsa del color ganador y se genera la bandeja **"Ganadores por
pagar"**. El cajero paga por Yape/Plin y marca el pago con su número de
operación. Invariante contable R26 probada por ronda.

No incluye: UI del historial para el jugador (009/011) ni reportes (012).

## Modelo — extensión de `bets`

- `payout_centimos` int null — premio calculado al liquidar; `0` explícito
  para perdedoras en bolsa; `null` si no aplicaba (QUEUED arrastrada,
  ANULADA, DEVUELTA).
- `paid_operation_number` text null — nº de operación del premio (R25).
- `paid_at` timestamptz null.

El premio es `floor(amountCentimos × multiplier / 100)` con el multiplicador
de la casilla ganadora (R2). Solo apuestas `POOL` del lado ganador cobran.

## Dominio — `domain/settlement.js` (puro)

`settle(round, slots, bets) → { payouts: [{betId, amount}], kept }`:
- `resultSlot` = casilla con `id === round.resultSlotId`.
- winners = bets `POOL` con `side === resultSlot.side`.
- `payout` por ganador (redondeo R2); `kept` = pool total − Σ payouts
  (lo que retiene la casa del lado perdedor + resto de redondeo).
- Propiedad fast-check: `Σ payouts + kept === poolTotal` y `kept ≥ 0`
  cuando la bolsa fue segura.

## Endpoints (cajero asignado o admin)

- `GET /rooms/:code/winners?seq=N` — bandeja "Ganadores por pagar": nombre,
  teléfono, monto del premio, ronda, estado (pendiente/pagado), nº de op.
  Por defecto la última ronda LIQUIDADA.
- `POST /rooms/:code/bets/:betId/pay { operationNumber }` — marca el premio
  como pagado (R25); solo bets con `payoutCentimos > 0` pendientes.
- `GET /rooms/:code/rounds/:seq/accounting` — desglose R26 por ronda:
  `received` (registradas netas de devueltas/anuladas), `pooled`,
  `carried`, `refunded`, `anulled`, `paidOut`, `kept`.

## UI `/cajero`

Sección "Ganadores por pagar": lista con monto a yapear y botón "marcar
pagado" (pide nº de operación). Se distingue pagada de pendiente.

## Criterios de aceptación

- AC-01: al liquidar, cada POOL del color ganador recibe
  `payout = floor(amount × mult / 100)`; las perdedoras quedan `0`.
- AC-02: `GET /winners` lista solo ganadoras con datos del jugador.
- AC-03: `pay` marca pagada con nº de operación; re-pagar → 409.
- AC-04: una apuesta QUEUED arrastrada no genera premio (va a la siguiente).
- AC-05: accounting identidad — `received = pooled + carried + refunded`
  (anuladas cuentan en auditoría pero no alteran lo recibido a devolver):
  toda la plata que entró queda trazada, ni un céntimo (R26).
- AC-06 (propiedad): para rondas seguras, `Σ payouts ≤ poolTotal` —
  la casa nunca queda negativa.
