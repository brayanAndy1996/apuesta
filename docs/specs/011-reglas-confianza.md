# Spec 011 — Reglas y confianza (R28)

## Objetivo

Sección pública accesible desde la página de la sala con todo lo que genera
confianza: cómo funciona, calculadora de ganancias, casillas con sus
porcentajes, historial con estadísticas reales frente a las esperadas, el
verificador de rondas y preguntas frecuentes.

## Alcance

### API

- `GET /rooms/:code/stats` (público): sobre las rondas `LIQUIDADA` devuelve
  `{ rounds, perColor: {red, blue}, slots: [...] }` donde cada casilla lleva
  `{ side, multiplier, weight, expectedCount, realCount, expectedPct,
  realPct }` — la distribución real de resultados frente a la esperada por
  pesos (R28 "estadísticas reales frente a las esperadas").
- El verificador es **cliente**: `/rooms/:code/rounds` ya expone `seed`,
  `seedHash` y `result` de cada ronda liquidada. La web recomputa
  `sha256(seed) === seedHash` y `BigInt("0x"+seed) % 100` sobre el orden
  canónico de casillas (`domain/draw.js`) → debe dar `result`. Verificar en
  el navegador del jugador es más confiable que preguntarle al servidor.

### Web — `/sala/[code]/reglas` (público) + enlace en la cabecera de la sala

- "¿Cómo funciona?" en 4 pasos (armas la apuesta → pagas por QR → el cajero
  confirma → la ruleta sortea y pagas si ganas).
- Calculadora: monto + color → rango de ganancia según las casillas
  (`winRange` del dominio público).
- Tabla de casillas con multiplicador y % por color.
- Historial: tabla seq/resultado/hora + estadísticas reales vs esperadas.
- Verificador: elegir ronda liquidada → muestra seed, hash publicado vs
  recomputado, pos y casilla recomputada vs oficial; verde/rojo.
- FAQ (mínimos/máximos, qué pasa si la ronda se pausa, cómo cobro, dinero
  ficticio en demo).

## Fuera de alcance

Reportes del admin (012), simulador (013).

## Criterios de aceptación

- AC-01 `GET /stats` con 0 liquidadas → `rounds:0`, `realPct` null por casilla.
- AC-02 Tras liquidar rondas con resultados conocidos, `realCount`/`realPct`
  por casilla coinciden y `perColor` suma `rounds`.
- AC-03 `expectedPct` = weight (los pesos suman 100).
- AC-04 La verificación en cliente reproduce `drawSlot`: semilla → pos →
  casilla oficial, y sha256(seed) === seedHash (probado en api con un vector
  conocido: `drawSlot` + `seedHash` sobre datos reales).

## Verificación

Tests `api/test/stats.test.js`; web lint+build; smoke de `/sala/GENERAL/reglas`.
