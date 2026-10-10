# Spec 002 — Login de administrador y cajero (PIN), roles

Fase 1 · Reglas: — · Planificación §2, §7

## Objetivo

Dos formas de entrar al sistema: el administrador con usuario y contraseña, y el cajero con nombre y PIN. Todo endpoint protegido verifica el rol del token.

## Decisiones

- **Token**: JWT firmado con `jose` (HS256), enviado como `Authorization: Bearer`. Vida de 12 h. La clave es `JWT_SECRET` (env). Documentado: para producción se evaluará rotación/refresh.
- **Hashes**: `crypto.scrypt` nativo de Node (sal aleatoria por usuario, formato `scrypt:N:r:p:sal:hash` en base64). Sin dependencias nativas. El PIN del cajero y la contraseña del admin usan el mismo esquema.
- **Admin único inicial**: se crea al arrancar si no existe, desde `ADMIN_USERNAME` + `ADMIN_PASSWORD` (env; en dev hay defaults en `.env.example` para demo). No hay registro público de admins.
- **Cajeros**: los crea el administrador con nombre + PIN de 4 a 6 dígitos. La asignación de cajero a sala viene en la spec 003 (salas). Un cajero puede estar activo/inactivo.
- **Login de cajero**: nombre de usuario (`username`, único, en minúsculas) + PIN numérico. El cajero no elige su username; lo genera el admin (`POST /admin/cashiers` lo devuelve).

## Modelo

`users`: `id` (uuid), `role` (`admin` | `cashier`), `username` (único, lowercase), `name`, `credential_hash` (scrypt), `active` (bool), `created_at`, `updated_at`.

## Endpoints

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/auth/login` | público | `{username, password}` → `{token, user}` para admin |
| POST | `/auth/pin` | público | `{username, pin}` → `{token, user}` para cajero |
| GET | `/auth/me` | cualquiera autenticado | datos del usuario del token |
| POST | `/admin/cashiers` | admin | `{name, pin}` → cajero creado con `username` autogenerado |
| GET | `/admin/cashiers` | admin | lista de cajeros |
| PATCH | `/admin/cashiers/:id` | admin | `{active?, pin?, name?}` desactivar/resetear |

Reglas:
- Login fallido → `401` genérico (`"credenciales inválidas"`), sin revelar si el usuario existe.
- Cajero `active=false` no puede hacer login ni usar tokens emitidos antes de su desactivación (el middleware re-verifica `active` en cada request).
- Errores de validación → `400` con detalles de Zod.

## Middleware

- `requireAuth`: verifica el JWT, carga el usuario, rechaza si no existe o está inactivo → `401`.
- `requireRole("admin" | "cashier")`: después de `requireAuth`, `403` si el rol no coincide.

## Web

- `/login`: dos formularios (Administrador / Cajero). Guarda el token en `localStorage` (`apuesta.token`) y el usuario en `apuesta.user`.
- `/admin` y `/cajero`: placeholders que llaman `/auth/me` y muestran nombre y rol; si no hay token o es inválido, redirigen a `/login`.
- `lib/api.ts`: helper que agrega el `Authorization` header.

## Tests (api)

- Login admin correcto/incorrecto.
- Login cajero con PIN correcto/incorrecto y con PIN no numérico.
- `/auth/me` con y sin token, y con rol equivocado (`403`).
- Cajero desactivado: login rechazado y token previo inválido.
- Creación de cajero solo con token de admin; PIN inválido → 400.
- Propiedad ligera: hash+verify de scrypt con entradas arbitrarias.

## Fuera de alcance

- Asignación de cajero a sala (spec 003), recuperación de contraseña, rate limiting (se anota como pendiente para producción), refresh tokens.

## Criterios de aceptación

1. Migración de `users` aplicada y admin sembrado desde env.
2. Los 6 endpoints responden según la tabla con validación Zod.
3. Un cajero desactivado pierde acceso de inmediato.
4. `/login` permite entrar como admin y como cajero; `/admin` y `/cajero` muestran el usuario autenticado.
5. `scripts/ci-local.sh` en verde con los nuevos tests.
6. `openapi.yaml` actualizado con las rutas nuevas.
