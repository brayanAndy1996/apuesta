# Spec 003 — Salas

Fase 1 · Reglas: R4, R5, R6 · Planificación §2, §4, §5

## Objetivo

El administrador crea salas permanentes: cada una con código propio, QR de Yape y de Plin, WhatsApp, topes de apuesta, sus propias casillas (multiplicadores y pesos) y un cajero asignado. Existe siempre la sala general.

## Reglas que aplica

- **R4**: todo pertenece a una sala. La sala general (`GENERAL`, expuesta en `/`) existe siempre; las demás las crea solo el administrador y tienen código propio (`/sala/K7P2`).
- **R5**: cada sala tiene su cajero (uno solo), su QR de Yape y Plin, su WhatsApp, sus topes y **sus propias casillas** (multiplicadores y pesos). Rondas, bolsas y caja llegan en specs posteriores.
- **R6**: cada multiplicador entre 1.01 y 1.99 (entero en centésimas: 101–199) y los pesos suman exactamente 100 %.

## Decisiones

- **Sala general**: fila `rooms` con `code = "GENERAL"`, creada por `ensureGeneralRoom()` al arrancar (igual que el admin de la 002). No se puede desactivar ni renombrar su código.
- **Código de sala**: 4 caracteres del alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sin 0/O/1/I/L), único, generado por el servidor.
- **Casillas**: tabla `room_slots` (`side` red|blue, `multiplier` entero 101–199, `weight` entero 1–99 como porcentaje). Se reemplazan en bloque (`PUT`): todas o ninguna. Debe haber al menos una casilla por color.
- **Default de casillas** (si el admin no las define): la tabla de R7 — por color: 1.5→5 %, 1.6→10 %, 1.7→20 %, 1.8→10 %, 1.9→5 %. **Ojo**: la tabla en planificacion.md suma 90 % (45 por color); se normaliza 1.7 a 20 para cumplir R6 (suma = 100). Si el dueño quería otra distribución, se ajusta aquí.
- **Un cajero por sala y una sala por cajero**: `cashier_id` es único entre salas (un cajero no atiende dos salas). Nullable: una sala puede crearse sin cajero y queda "sin asignar".
- **Montos en céntimos** (R1): `min_bet_centimos` (default 100 = S/ 1.00) y `max_bet_centimos` (default 5000 = S/ 50.00).

## Modelo

`rooms`: `id` uuid, `code` (único, uppercase), `name`, `whatsapp` (teléfono texto), `yape_qr` (texto/URL), `plin_qr`, `min_bet_centimos` int, `max_bet_centimos` int, `cashier_id` FK→users nullable único, `active` bool, timestamps.
`room_slots`: `id` uuid, `room_id` FK, `side` string, `multiplier` int, `weight` int.

## Endpoints

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/rooms` | público | lista de salas activas (code, name) |
| GET | `/rooms/:code` | público | sala pública: nombre, topes, casillas con %, whatsapp, QR |
| POST | `/admin/rooms` | admin | crear sala (devuelve `code` generado) |
| GET | `/admin/rooms` | admin | lista completa (incluye inactivas, cajero asignado) |
| GET | `/admin/rooms/:id` | admin | detalle con casillas y cajero |
| PATCH | `/admin/rooms/:id` | admin | name, whatsapp, yapeQr, plinQr, topes, cashierId, active |
| PUT | `/admin/rooms/:id/slots` | admin | reemplaza las casillas en una transacción |

Validaciones:
- `minBet < maxBet`, ambos en céntimos positivos.
- `cashierId` debe existir, tener rol cashier, estar activo y no asignado a otra sala → 409 si está ocupado.
- Casillas: `multiplier` entero 101–199, `weight` entero 1–99, `side` red|blue, suma de pesos = 100, ≥1 casilla por color.
- `GET /rooms/:code` con sala inexistente o inactiva → 404.
- `GET /rooms` siempre incluye `GENERAL` aunque esté "sin cajero".

## Web

- `/admin`: sección "Salas": tabla (código, nombre, cajero, topes, estado) + formulario de creación (nombre, whatsapp, QR Yape/Plin, topes, cajero opcional, casillas por defecto o editor simple de filas) + editor de casillas por sala (filas: color, multiplicador, peso; valida suma = 100 en cliente antes de enviar).
- `/sala/[code]`: página pública placeholder que muestra datos de `GET /rooms/:code` (nombre, topes, casillas). La ruleta en vivo llega en la spec 009.

## Tests (api)

- Sala general existe tras boot; aparece en `GET /rooms`.
- Crear sala → código de 4 chars único; aparece en público.
- `PUT slots`: suma ≠ 100 → 400; multiplicador fuera de rango → 400; sin casillas de un color → 400; válido → reemplazo completo.
- Asignar cajero: inexistente → 400; con rol admin → 400; ya asignado a otra sala → 409.
- Sala inactiva → 404 en público; admin la sigue viendo.
- Defaults de casillas = tabla de R7.

## Fuera de alcance

- Rondas/bolsas/caja por sala (specs 004+), carga de imágenes QR (el campo guarda texto/URL), historial.

## Criterios de aceptación

1. `GET /rooms` incluye `GENERAL` recién instalado.
2. Crear sala con configuración completa responde 201 con código y es visible en `/sala/:code`.
3. Todas las validaciones de R6 rechazan payloads inválidos con 400 y mensaje claro.
4. Un cajero no puede asignarse a dos salas.
5. `ci-local.sh` en verde y `openapi.yaml` actualizado.
