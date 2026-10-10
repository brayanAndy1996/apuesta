# Ruleta Rápida — Planificación

Versión 1 · 2026-10-09 · Fuente de verdad para escribir las specs.

## 1. Visión

Web de apuestas rápidas: una ruleta donde se apuesta al **rojo** o al **azul**. Si gana tu color, recibes tu apuesta multiplicada por un valor entre **1.5 y 1.9** que sortea la ruleta. El pago es por Yape o Plin y la confirmación se hace por WhatsApp; un cajero registra cada apuesta. La casa nunca pierde porque las bolsas de ambos colores se mantienen equilibradas.

**Alcance actual: DEMO con dinero ficticio.** Antes de operar con dinero real, el dueño consultará a un abogado (Ley 31557, autorización MINCETUR; Ley 29733, datos personales) y a un contador.

## 2. Actores

| Actor | Qué hace | Acceso |
|---|---|---|
| Jugador | Elige color y monto en la página, yapea o plinea al QR y envía el mensaje de WhatsApp ya escrito. Ve la ruleta en vivo. | Público, sin cuenta |
| Cajero (trabajador) | Revisa en su app que el pago llegó y registra la apuesta. Paga a los ganadores y devuelve saldos a favor. Uno por sala. | Login con PIN |
| Administrador (dueño) | Crea salas, asigna cajeros, configura topes y casillas, y ve reportes de todas las salas. | Login |
| Pantalla pública | Muestra la ruleta, las bolsas, la espera, la lista de apuestas, el historial y las reglas. | Pública |

## 3. Glosario (español → código)

sala = room, ronda = round, apuesta = bet, bolsa = pool, color = side (red, blue), casilla = slot, multiplicador = multiplier, peso = weight, en espera = queued, saldo a favor = credit, pago al ganador = payout, devolución = refund, cajero = cashier, administrador = admin, jugador = player, número de operación = operationNumber, método = paymentMethod (yape, plin), sorteo = draw, semilla = seed.

## 4. Reglas de negocio (no negociables)

### Dinero
- **R1.** El dinero se guarda y calcula en **céntimos enteros**. Prohibido usar float.
- **R2.** Los multiplicadores se guardan como enteros en centésimas (1.70 = 170). El pago se calcula como `floor(monto_céntimos × multiplicador / 100)`, es decir, redondeado **hacia abajo** al céntimo. Esta regla se publica en las reglas.
- **R3.** Una apuesta va de **S/ 1.00 a S/ 50.00** (configurable por sala) y admite céntimos. El tope es **por apuesta**.

### Salas
- **R4.** Todo pertenece a una sala. Existe la **sala general** (`/`) y otras salas **permanentes** con un código propio (`/sala/K7P2`), creadas **solo por el administrador**.
- **R5.** Cada sala tiene su propio cajero (uno solo), su QR de Yape y de Plin, su WhatsApp, sus topes, **sus propias casillas (multiplicadores y pesos)**, sus rondas, sus bolsas y su caja.
- **R6.** Al configurar las casillas, cada multiplicador debe estar entre 1.01 y 1.99 y los pesos deben sumar 100 %. Si un multiplicador fuera 2 o más, la casa podría perder aunque las bolsas estén iguales.

### Ruleta
- **R7.** La ruleta tiene casillas de color y multiplicador. Por defecto son 10, con pesos simétricos y el pico en 1.7:

  | | 1.5 | 1.6 | 1.7 | 1.8 | 1.9 |
  |---|---|---|---|---|---|
  | Rojo | 5 % | 10 % | 15 % | 10 % | 5 % |
  | Azul | 5 % | 10 % | 15 % | 10 % | 5 % |

  La ruleta muestra el porcentaje de cada casilla y el tamaño visual de cada una es proporcional a su peso.
- **R8.** El sorteo es aleatorio, criptográficamente seguro y **verificable**. El hash de la semilla se publica al abrir la ronda y la semilla se revela al liquidarla.
- **R9.** El resultado se guarda **antes** de la animación. El giro dura 7 s y es solo visual. Nunca se vuelve a sortear una ronda.

### Seguridad de la bolsa
- **R10.** Una ronda es **segura** cuando la bolsa total es de S/ 10 o más y ningún color, multiplicado por el multiplicador máximo de la sala, supera la bolsa total: `max(rojo, azul) × mult_max ≤ total`.
- **R11.** Una apuesta **entra a la bolsa** solo si, junto con las que esperan del otro color, la ronda queda segura. Si no, queda **en espera**. La cola de cada color se respeta por orden de llegada.
- **R12.** Ejemplo de referencia. Rojo 30 y azul 20: el rojo está bloqueado. Llega +10 al rojo y queda en espera. Llega +20 al azul: entran ambas y queda 40 contra 40.
- **R13.** La pantalla muestra, por color, lo que hay en bolsa, lo que hay en espera, si está bloqueado y cuánto falta del otro color.

### Ciclo de la ronda
- **R14.** Estados: `ESPERANDO → CUENTA_REGRESIVA → (PAUSADA) → CERRADA → GIRANDO → LIQUIDADA`.
- **R15.** Cuando la ronda es segura empieza una cuenta regresiva de **60 s**. Cada apuesta que **entra** a la bolsa la reinicia (las que quedan en espera no). Si la ronda deja de ser segura, la cuenta pasa a **PAUSADA**.
- **R16.** **Tiempo máximo de 5 min**, contado desde la primera apuesta que entra:
  - Si la ronda está desbalanceada pero hay apuestas en ambos colores, se iguala: de la cola del color que sobra entra solo lo necesario para igualar, por orden de llegada. Una apuesta puede entrar en parte y lo que no entra **pasa a la próxima ronda** al inicio de la cola. La ronda **gira de inmediato**.
  - Si solo hay apuestas de un color o la bolsa no llega a S/ 10, la ronda **queda abierta** esperando.
- **R17.** Las apuestas registradas durante CERRADA o GIRANDO pasan a la ronda siguiente. Al liquidar, la siguiente ronda se abre automáticamente y recibe primero las apuestas arrastradas.

### Registro de apuestas
- **R18.** El jugador arma su apuesta en la página (sala, color, monto, nombre y apellido, teléfono). La página muestra el QR y un botón que abre WhatsApp con el mensaje ya escrito:
  `APUESTA · Sala GENERAL · ROJO · S/ 10.00 · Juan Pérez · 987654321`
- **R19.** El cajero **verifica en su app** que el pago llegó y luego registra la apuesta en un formulario rápido: puede pegar el mensaje para que se autocomplete, y escribe el método y el número de operación. El sistema exige marcar "pago verificado".
- **R20.** El número de operación es **único por método**. Un duplicado se rechaza.
- **R21.** Si el pago supera el máximo (por ejemplo, S/ 60), se registra S/ 50 y el excedente queda **en espera** como otra apuesta del mismo color.
- **R22.** Si el mensaje no indica el color, el pago va a la bandeja **"Sin color"** hasta que el jugador aclare.
- **R23.** Antes de que cierre la ronda, el cajero puede anular una apuesta indicando un motivo, y queda en auditoría. Después del cierre no se puede modificar.
- **R24.** Si un jugador lo pide, el cajero puede **devolver** una apuesta que está en espera (saldo a favor) y registrar el número de operación de la devolución.

### Pagos
- **R25.** Al liquidar se genera la lista **"Ganadores por pagar"** (nombre, teléfono, monto, ronda). El cajero yapea o plinea el premio y lo marca como pagado con el número de operación.
- **R26.** Invariantes que se prueban: la casa nunca queda negativa en una ronda, y la suma de lo recibido es igual a la bolsa más la espera más lo devuelto. Nunca se pierde un céntimo.

### Transparencia
- **R27.** La lista pública de apuestas de la ronda muestra: nombre e inicial del apellido, teléfono parcialmente oculto (`*** *** 321`), monto, color, hora y "gana entre S/ X y S/ Y".
- **R28.** La sección de reglas, accesible desde toda la página, incluye: "¿Cómo funciona?" en 4 pasos, una calculadora de ganancias, las casillas con sus porcentajes, el historial con estadísticas reales frente a las esperadas, el verificador de rondas y preguntas frecuentes.
- **R29.** Hay un botón de consultas por WhatsApp visible en toda la página.

### General
- **R30.** Zona horaria America/Lima.
- **R31.** Modo demo: el dinero es ficticio y un botón "Simular apuestas" genera jugadores de prueba.

## 5. Arquitectura

```
apuesta/                 ← repo coordinador (Devin corre aquí)
├── AGENTS.md, docs/ (planificacion, specs, decisions, api/openapi.yaml, PROGRESS)
├── api/               Node 24 LTS, Express 5, Sequelize + migraciones, PostgreSQL 17, Socket.IO, Zod
└── web/               Next.js (App Router), Tailwind, TanStack Query, socket.io-client
```

api/ y web/ son carpetas del mismo repo por ahora; si más adelante se separan en repos propios, el contenido se migra tal cual.

- **Contrato:** `docs/api/openapi.yaml`. La web genera sus tipos con openapi-typescript.
- **Dominio puro** en `api/src/domain/` (seguridad de la bolsa, cola, igualación, redondeo, sorteo), sin base de datos y con pruebas de propiedades (fast-check).
- **Concurrencia:** cada cambio a una ronda ocurre en una transacción con `SELECT ... FOR UPDATE` sobre la ronda.
- **Temporizadores:** el servidor es la autoridad. Los plazos se guardan en la base de datos para sobrevivir a un reinicio.
- **Tiempo real:** Socket.IO con un canal por sala.

## 6. Roles (equivalentes en Devin)

No hay subagentes por modelo: todas las sesiones corren con el modelo de Devin. Los roles se diferencian por **función** y se materializan como prompts de sesiones hijas de Devin (cada una en su propia VM) o como trabajo directo de la sesión orquestadora:

| Rol | Cómo se ejecuta en Devin |
|---|---|
| Orquestador | La sesión principal de Devin: escribe specs, coordina hijos, revisa y fusiona |
| spec-writer | Sesión principal (una spec por vez, en `docs/specs/`) |
| test-writer | Sesión hija o directo, según tamaño de la spec |
| backend-dev / frontend-dev | Sesiones hijas en paralelo para specs grandes |
| test-runner | Comandos de la spec (`npm test`, lint, build) ejecutados por cualquier sesión |
| adversarial-tester | Sesión hija con prompt de testing adversarial sobre el PR |
| reviewer | Revisión por la sesión orquestadora + Devin Review en el PR |

## 7. Specs

| Fase | # | Spec | Reglas |
|---|---|---|---|
| 0 Base | 001 | Estructura, ambos repos, BD, /health, scripts, CI local | — |
| 1 Acceso y salas | 002 | Login de administrador y cajero (PIN), roles | — |
| | 003 | Salas: crear, código, QR, WhatsApp, topes, casillas, asignar cajero | R4–R6 |
| 2 Motor | 004 | Dominio puro: seguridad, cola, igualación, redondeo | R1–R3, R10–R12, R16, R26 |
| | 005 | Ciclo de la ronda y temporizadores | R14–R17 |
| | 006 | Sorteo verificable | R7–R9 |
| 3 Operación | 007 | Registro rápido de apuestas por el cajero | R19–R24 |
| | 008 | Liquidación y bandejas (ganadores, sin color, en espera) | R25, R26 |
| 4 Jugador | 009 | Pantalla pública en vivo (ruleta, bolsas, espera, lista) | R13, R27 |
| | 010 | Armar la apuesta: QR y WhatsApp ya escrito | R18, R29 |
| | 011 | Reglas y confianza (cómo funciona, calculadora, estadísticas, verificador) | R28 |
| 5 Control | 012 | Reportes por sala y día, y auditoría | R23, R30 |
| | 013 | Modo demo y simulador | R31 |

## 8. Fuera de alcance (después)

- Leer capturas de Yape con IA (Haiku con visión) para autocompletar.
- Integración automática con Yape, Plin o WhatsApp Business API.
- Dinero real (requiere asesoría legal y contable).
- Docker y despliegue en la nube.

## 9. Decisiones del usuario

| Fecha | Decisión |
|---|---|
| 2026-10-09 | Primero una demo con saldo ficticio; luego abogado y contador. |
| 2026-10-09 | Opción A: multiplicador por ruleta con tope por lado. |
| 2026-10-09 | Pesos con el pico en 1.7 y porcentajes visibles. |
| 2026-10-09 | Sin billetera: Yape o Plin más WhatsApp, y el cajero registra. |
| 2026-10-09 | Apuestas de S/ 1 a S/ 50 por apuesta, con céntimos y redondeo hacia abajo. Varias apuestas y ambos colores permitidos. |
| 2026-10-09 | Ronda con S/ 10 o más, 60 s desde la última apuesta, máximo 5 min y giro de 7 s. |
| 2026-10-09 | Al cumplirse los 5 min se iguala y lo que sobra pasa a la próxima ronda; si solo hay apuestas de un color, queda abierta; después de igualar, gira de inmediato. |
| 2026-10-09 | Estado de espera visible; las apuestas entran juntas si así queda segura. |
| 2026-10-09 | Salas permanentes creadas solo por el administrador, cada una con su caja, su cajero y sus propias tasas. Los cajeros son trabajadores, no socios. |
| 2026-10-09 | El jugador envía un mensaje de WhatsApp ya escrito; el cajero puede devolver saldos a favor. |
| 2026-10-09 | La lectura de capturas con IA queda para después. |
| 2026-10-09 | Proyecto separado en repos (no monorepo) dentro de una carpeta coordinadora. |
