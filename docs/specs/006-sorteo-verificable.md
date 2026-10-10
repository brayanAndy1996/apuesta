# Spec 006 — Sorteo verificable (R7–R9)

## Alcance

Al cerrar una ronda se elige la casilla ganadora de forma determinista a partir
de la semilla comprometida, se guarda `result_slot_id` **antes** de que empiece
la animación de 7 s y nunca se vuelve a sortear. La semilla se publica al
liquidar para que cualquiera pueda verificar.

Fuera de alcance: la liquidación de pagos a ganadores (spec 008) y el
verificador en la página de reglas (spec 011).

## Sorteo (dominio puro, `api/src/domain/draw.js`)

```js
pos = BigInt("0x" + seed) % totalWeight   // totalWeight = 100 (R6)
```

- `seed` es el hex de 32 bytes guardado en `rounds.seed` al crear la ronda;
  `rounds.seed_hash = sha256(seed)` ya se publica desde la spec 005.
- **Orden canónico de casillas** (parte del contrato, documentado aquí y en el
  código): primero todas las `red` ordenadas por `multiplier` ascendente, luego
  todas las `blue` por `multiplier` ascendente. Se recorren acumulando `weight`;
  gana la primera casilla cuyo acumulado supera `pos`.
- `drawSlot(seed, slots) → { slot, pos }` puro y determinista: misma semilla y
  mismas casillas ⇒ mismo resultado.
- Rechaza pesos que no sumen exactamente `totalWeight` (validación R6 ya existe
  al guardar casillas; el dominio lo revalida para no sortear con basura).

## Integración (spec 005)

- `closeAndSpin(round, room, now)` elige la casilla con `drawSlot` usando las
  casillas de la sala y fija `round.resultSlotId` y `round.seed` queda en la
  fila (ya estaba). Esto ocurre dentro de la misma transacción del cierre
  (cuenta vencida o igualación) → R9: el resultado existe antes de `GIRANDO`.
- `resultSlotId` solo se escribe una vez: si ya está poblado no se recalcula.
- Al liquidar, la fila conserva `seed` + `seedHash` + `resultSlotId`: con la
  semilla revelada cualquiera recomputa `pos` y la casilla.

## Exposición

- `GET /rooms/:code/round` añade `result` (casilla ganadora `{ side, multiplier }`)
  cuando el estado es `GIRANDO` o posterior — el evento `round:update` ya lleva
  `resultSlotId`; ambos son públicos porque el hash se comprometió antes.
- `GET /rooms/:code/rounds?limit=20` — historial público de la sala, más
  reciente primero: `{ seq, state, seedHash, seed (solo LIQUIDADA), result
  (casilla), createdAt }`. Base del verificador (011) y del historial (R28).

## Criterios de aceptación (AC)

- AC-01: `drawSlot` es determinista y cae dentro de las casillas dadas.
- AC-02: la distribución por peso es aproximadamente proporcional (test
  estadístico sobre muchas semillas, tolerancia amplia).
- AC-03: al vencer la cuenta, la ronda pasa a `GIRANDO` con `resultSlotId`
  ya poblado y `seed` guardado en la misma transacción.
- AC-04: el resultado no cambia si `processExpiredRounds` corre más veces
  (idempotente, R9).
- AC-05: `GET .../rounds` muestra `seed` solo en rondas `LIQUIDADA` y
  `sha256(seed) === seedHash`.
- AC-06: propiedad fast-check — para cualquier peso válido, `drawSlot` con
  semillas arbitrarias siempre elige una casilla y nunca sale del rango.
