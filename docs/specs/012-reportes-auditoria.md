# Spec 012 — Reportes por sala y día, y auditoría (R23, R30)

## Objetivo

El administrador revisa, por sala y por día (calendario America/Lima), cuánto
se recibió, pagó, devolvió y anuló; y una lista de auditoría con cada acción
del cajero que movió dinero: anulaciones, devoluciones y premios marcados como
pagados — con quién la hizo y cuándo.

## Decisiones

- **Solo admin** ve reportes y auditoría (planificación: "el administrador ve
  reportes de todas las salas"). El cajero sigue con sus bandejas operativas.
- **Día = calendario America/Lima** (R30). Perú no tiene DST: el día
  `YYYY-MM-DD` es el rango `[T00:00:00-05:00, T00:00:00-05:00+24h)` en UTC.
- **Atribución por ronda**: una ronda (y sus apuestas) cuenta en el día Lima
  en que se **creó** (`rounds.created_at`). Las rondas duran ~2 min; el borde
  de medianoche afecta a lo sumo a una ronda en curso.
- **Auditoría por evento**: anulación (`ANULADA`), devolución (`DEVUELTA`) y
  premio pagado (`PAGADA`) se listan con actor. Se registran tres columnas
  nuevas en `bets`: `annulled_by_id`, `refunded_by_id`, `paid_by_id` —
  antes no se sabía quién ejecutó la acción.

## API

### `GET /admin/reports/daily?code=CODE&date=YYYY-MM-DD` (admin)

```json
{
  "room": { "code": "GENERAL", "name": "Sala general" },
  "date": "2026-10-10",
  "rounds": 3,
  "bets": 12,
  "collectedCentimos": 8000,
  "pooledCentimos": 7000,
  "carriedCentimos": 1000,
  "annulledCentimos": 500,
  "annulledCount": 1,
  "refundedCentimos": 500,
  "refundedCount": 1,
  "payoutsCentimos": 5000,
  "payoutsPaidCentimos": 3000,
  "winners": { "total": 3, "paid": 2, "pending": 1 }
}
```

- `collected` = suma de `amount` de todas las apuestas de las rondas del día
  (POOL + QUEUED que vinieron de esa ronda + ANULADA + DEVUELTA).
- `pooled` = lo que quedó en bolsa (POOL). `carried` = lo arrastrado a la
  siguiente ronda (QUEUED con `originRoundId` = ronda del día). `annulled` /
  `refunded` por estado y monto.
- `payouts` = suma de `payoutCentimos` de las POOL; `payoutsPaid` = los que
  ya tienen `paidAt`. `winners` = apuestas con `payoutCentimos > 0`.
- Sala inexistente → 404; `date` malformada → 400; sin admin → 401/403.

### `GET /admin/audit?code=CODE&date=YYYY-MM-DD` (admin)

```json
{
  "events": [
    {
      "type": "ANULADA",
      "at": "2026-10-11T03:12:00.000Z",
      "roundSeq": 4,
      "betSeq": 9,
      "playerName": "Rosa Quispe",
      "amountCentimos": 2000,
      "detail": "el jugador se equivocó de monto",
      "actor": { "id": "…", "name": "María Cajera" }
    },
    { "type": "DEVUELTA", "detail": "op-ref-77", "…": "…" },
    { "type": "PAGADA", "detail": "op-pago-31", "…": "…" }
  ]
}
```

- `at`: para PAGADA es `paidAt`; para ANULADA/DEVUELTA es `updatedAt` (el
  cambio de estado es el último evento de la apuesta).
- `detail`: `annulReason` / `refundOperationNumber` / `paidOperationNumber`.
- `actor`: quien ejecutó la acción (`annulledById`/`refundedById`/`paidById`),
  `null` en registros antiguos sin actor.
- Orden por `at` descendente; límite 200 eventos.

## Cambios en servicios existentes

- `annulBet(room, betId, reason, actorId)` → guarda `annulledById`.
- `refundBet(room, betId, opNumber, actorId)` → guarda `refundedById`.
- `payBet(room, betId, opNumber, actorId)` → guarda `paidById`.
- Las rutas ya reciben `req.user` (betAction) — solo se enchufa el id.

## Web — `/admin/reportes`

Selector de sala + fecha (por defecto hoy, Lima) → tarjeta de totales del
día + tabla de auditoría (tipo, hora Lima, ronda/apuesta, jugador, monto,
detalle, actor). Enlace desde `/admin`.

## Criterios de aceptación

- AC-01: el reporte del día agrega bien (`collected = pooled + carried +
  annulled + refunded` en montos; `winners` cuadra con payouts).
- AC-02: el borde de día es Lima: una ronda creada 23:55 Lima cae en ese día;
  una a 00:05 en el siguiente. (Se verifica con `created_at` controlado.)
- AC-03: la auditoría lista anulación/devolución/pago con motivo u nº de
  operación, actor y hora, ordenada descendente.
- AC-04: anónimo → 401, cajero → 403, admin de otra data no filtra (solo la
  sala pedida).
- AC-05: `date` inválida → 400; sala inexistente → 404.

## Fuera de alcance

Exportar CSV/PDF, gráficos, reporte multi-sala agregado, filtros por cajero.
