# ADR-001: casillas por defecto normalizadas a 100 %

## Contexto

La tabla de casillas por defecto de `planificacion.md` (R7) suma **90 %** de peso
(45 por color: 5/10/15/10/5), pero R6 exige que los pesos sumen **100 %**.

## Decisión

Normalizar el multiplicador 1.7 a peso 20 por color → `5/10/20/10/5` = 50 por
color, 100 % total. Definido en `api/src/models/room.js` (`DEFAULT_SLOTS`) con
comentario que referencia esta decisión.

## Estado

Aceptada (spec 003). Si se prefiere otra distribución, basta cambiar
`DEFAULT_SLOTS`; la validación de R6 sigue aplicando a cualquier configuración.
