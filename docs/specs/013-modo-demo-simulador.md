# Spec 013 — Modo demo y simulador

Reglas: **R31** (modo demo: el dinero es ficticio y un botón "Simular apuestas"
genera jugadores de prueba).

## Alcance

Una forma de poblar la sala con apuestas de prueba para demos: un botón que
registra N apuestas simuladas en la ronda abierta de la sala, marcadas como
simuladas. Todo lo demás del flujo es el real: entran por la misma cola de la
bolsa, cuentan en estadísticas y reportes, y se liquidan igual.

### Decisiones

- Las apuestas simuladas **pasan por `placeBet` igual que las reales** — la
  demo muestra el sistema verdadero, no un camino paralelo.
- `bets` gana `is_simulated BOOLEAN NOT NULL DEFAULT false`. Simuladas:
  `operation_number` `SIM-<aleatorio>` (válido contra la unicidad R20),
  `player_name` de una lista de nombres de prueba, `phone` ficticio
  `9XXXXXXXX`, `payment_verified = true` (son demo, no plata real).
- Nº de operación simulado con prefijo `SIM-`: identificable en auditoría y
  reportes, y jamás colisiona con un nº real de Yape/Plin.
- `POST /rooms/:code/simulate` — solo admin y el cajero asignado (misma
  permisología que registrar apuestas reales). Body: `{ count }` 1–20,
  opcional `{ side }` para forzar color (default: alterna/aleatorio). Cada
  apuesta usa un monto aleatorio entre mínimo y máximo de la sala.
- Botón **"Simular apuestas"** en `/cajero` junto a la bandeja de registro.
- La lista pública enmascarada devuelve `isSimulated` por apuesta para que la
  pantalla pueda marcarlas (badge "demo" en `/sala/[code]`).
- Banner en `/sala/[code]` ya cubierto: la página es demo por naturaleza; el
  badge por apuesta es suficiente señal.

### Fuera de alcance

- Borrado masivo de apuestas simuladas (el reset de demo es una limpieza de
  BD; se puede añadir después).
- Simulación de todo el flujo del cajero (pagar premios, anular) — el botón
  solo crea apuestas; el resto se opera igual que con reales.

## Endpoints

- `POST /rooms/:code/simulate` (auth: cajero asignado o admin) →
  `{ bets: [...] }` — las apuestas registradas (como `POST /bets`).
- `GET /rooms/:code/public-bets` → cada item gana `isSimulated`.

## Criterios de aceptación

- **AC-01**: `POST /simulate` con `{count: 3}` registra 3 apuestas en la ronda
  abierta, con nombres/teléfonos/nº de operación ficticios (`SIM-…`),
  `paymentVerified: true`, `isSimulated: true`, y montos dentro de los topes
  de la sala.
- **AC-02**: las simuladas entran a la bolsa/cola normal — `GET /round`
  muestra `pool*`/`queued` igual que con apuestas reales.
- **AC-03**: `{side: "blue"}` fuerza el color; sin `side`, se reparten.
- **AC-04**: `count` fuera de 1–20 → 400; sin auth → 401; cajero de otra sala
  → 403.
- **AC-05**: `GET /public-bets` marca `isSimulated: true` en las simuladas y
  `false` en las reales.
- **AC-06**: en `/cajero` el botón "Simular apuestas" dispara el endpoint y la
  lista de la sala se actualiza por socket.
