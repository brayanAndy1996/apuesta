# Spec 004 — Dominio puro: seguridad de la bolsa, cola, igualación y redondeo

Reglas cubiertas: R1, R2, R3, R10, R11, R12, R16, R26.

## Qué se construye

`api/src/domain/pool.js`: módulo **puro** (sin Sequelize, sin Express, sin reloj, sin aleatoriedad). Todo el dinero en céntimos enteros (R1); multiplicadores en centésimas (R2).

No hay endpoints ni tablas nuevas: la ronda persistente llega en la spec 005 y el sorteo en la 006. Este módulo es la pieza que ambas reutilizan.

## Funciones

- `payout(amountCentimos, multiplier)` → `floor(amount × multiplier / 100)` (R2).
- `maxMultiplier(slots)` → mayor multiplicador de las casillas de la sala.
- `validateBet(amount, minBet, maxBet)` → error si fuera del rango o no es entero (R3).
- `isSecure(redPool, bluePool, multMax, minTotal = 1000)` → `total ≥ minTotal` **y** `max(red, blue) × multMax ≤ total × 100` (R10).
- `admit(state, bet)` / `drain(state)` — modelo de cola (R11, R12):
  - Estado: `{ multMax, minTotal, seq, pools: {red, blue}, queues: {red: Bet[], blue: Bet[]} }`, cada `Bet` = `{ seq, side, amount }` con `seq` creciente de llegada.
  - Regla de admisión, **literal a R11**: el frente de la cola entra si `isSecure(pool_propio + apuesta, pool_otro + suma_cola_otro)`. Se cuenta **toda** la cola del otro color (no prefijos): "junto con las que esperan del otro color".
  - Al drenar se evalúa primero la apuesta más antigua en espera (menor `seq`); si no puede entrar, se intenta el frente del otro color. Repite hasta que ningún frente pueda entrar.
  - **Consecuencia documentada**: una apuesta puede entrar cubierta por la cola del otro color y dejar ese color varado (la bolsa queda insegura). Es el estado `PAUSADA` de R15 — no es un error: la ronda espera más apuestas del otro color o la igualación de los 5 min (R16) la resuelve.
- `equalize(state)` — igualación a los 5 min (R16):
  - Solo si hay demanda (bolsa + espera) en **ambos** colores y la bolsa no es segura.
  - El color con menos bolsa recibe `deficit = poolMayor − poolMenor` desde su cola, por orden de llegada; una apuesta puede partirse y el resto queda **al inicio de la cola** para la próxima ronda.
  - Si la cola no alcanza para igualar, no entra nada y la ronda queda abierta (`spun=false`). Si queda igualada, `spun=true` y gira de inmediato.
- `missingFor(state, side)` → `{ min, max }` de céntimos que faltan del otro color para desbloquear el frente (R13, lo consume la pantalla en la 009).

## Invariantes probados con fast-check (R26)

- La casa nunca queda negativa: si `isSecure`, entonces `payout(max, multMax) ≤ total`.
- Conservación: `recibido = bolsa + espera + arrastrado` (nunca se pierde un céntimo).
- FIFO dentro de cada color (ninguna apuesta adelanta a otra del mismo color).
- Seguridad al drenar: tras `drain`, ninguna apuesta adicional de las colas puede entrar sin violar `isSecure`.
- Igualación: tras `equalize` con `spun=true`, las bolsas son iguales y el arrastre quedó al frente de su cola.
- `payout` es monótono en monto y nunca excede `amount × 1.99`.

## Pruebas

- `test/pool.test.js`: fast-check sobre secuencias aleatorias de apuestas + casos concretos:
  - Ejemplo R12 literal (30/20 → +10 rojo espera → +20 azul → 40/40).
  - Bolsa menor a S/ 10 nunca es segura.
  - Apuesta gigante del otro color no bloquea prefijos válidos.
  - Igualación con apuesta parcial arrastrada.
- fast-check corre con `numRuns` por defecto (100) en CI.
