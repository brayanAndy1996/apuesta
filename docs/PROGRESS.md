# PROGRESS — Ruleta Rápida

Estado del proyecto siguiendo el roadmap de 13 specs (planificacion.md §7).

## Estado actual

- **Spec en curso**: 011 — reglas y confianza.
- **PR abierto acumulado**: #3 (`devin/fix-review-002` → `main`) contiene
  specs 002-fixes + 003 + 004. Encima se apilan #6 (005), #8 (006+007),
  #9 (008), #10 (009), #11 (010) y #12 (011). Al mergear #3, `main` recibe
  todo junto y GitHub retargeta el resto en cascada.

## Tabla de funcionalidades

| Spec | Contenido | Estado | PR |
|------|-----------|--------|-----|
| 001 | Estructura base (api + web + BD + scripts + CI) | ✅ mergeada | #1 |
| 002 | Login admin + cajero PIN, roles JWT | ✅ mergeada | #2 |
| — | Fixes de review (prod guard, sesión, tests) | 🟡 en PR #3 | #3 |
| 003 | Salas: modelo, endpoints admin/públicos, UI | 🟡 en PR #3 (mergeada a la rama) | #4 |
| 004 | Dominio puro de la bolsa + fast-check | 🟡 en PR #3 (mergeada a la rama) | #5 |
| 005 | Ciclo de ronda: estados, timers, sockets, bets | 🟡 en PR #6 | #6 |
| 006 | Sorteo verificable (casilla por semilla, historial) | 🟡 en PR #7 | #7 |
| 007 | Registro del cajero: pagos, sin color, anular/devolver | 🟡 en PR #8 | #8 |
| 008 | Liquidación: premios, winners, marcar pagada | 🟡 en PR #9 | #9 |
| 009 | Pantalla pública en vivo: bolsa, cola, lista enmascarada, socket | 🟡 en PR #10 | #10 |
| 010 | Armar la apuesta: QR + WhatsApp ya escrito | 🟡 en PR #11 | #11 |
| 011 | Reglas y confianza: stats, verificador, FAQ | 🟡 en PR #12 | #12 |
| 012 | Reportes por sala y día, y auditoría | 🟡 en PR #14 | #14 |
| 013 | Modo demo y simulador | ⬜ pendiente | — |

## Deuda técnica conocida

- `POST /rooms/:code/bets` es **provisional**: la spec 007 lo reemplaza con el
  registro completo del cajero (número de operación, método Yape/Plin, estado
  de pago).
- La elección del slot ganador y la liquidación de pagos se hacen en la
  transición CERRADA→GIRANDO que hoy es inmediata (spec 006).
- La pantalla pública aún no consume Socket.IO (spec 009).
