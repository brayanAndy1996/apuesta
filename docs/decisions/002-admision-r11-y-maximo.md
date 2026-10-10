# ADR-002: admisión literal de R11 y reintento de igualación

## Contexto

R11 dice que una apuesta entra a la bolsa si, **junto con todas las que esperan
del otro color**, la bolsa sigue segura. La lectura literal cuenta la cola
completa del color contrario, no prefijos.

## Consecuencia aceptada

Una apuesta puede entrar "cubierta" por la cola contraria y dejar esa cola
varada: la bolsa queda insegura (`PAUSADA`) aunque haya dinero esperando. Esto
**no es un bug**: es exactamente el estado que la igualación de R16 resuelve a
los 5 minutos. Documentado en spec 004 y en tests.

## Decisión

1. `canAdmit` usa `queueSum(queues[other])` completo (literal R11).
2. Cuando el máximo de 5 min vence y la igualación no logra girar
   (`spun = false`, p. ej. demanda de un solo color o cola ligera insuficiente),
   la ronda marca `max_expired` y **reintenta la igualación tras cada admisión**
   posterior en lugar de esperar otro ciclo completo. Si vuelve a haber demanda
   suficiente, gira de inmediato.

## Estado

Aceptada (specs 004–005).
