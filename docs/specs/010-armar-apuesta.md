# Spec 010 — Armar la apuesta: QR y WhatsApp ya escrito (R18, R29)

## Objetivo

El jugador arma su apuesta en la página pública (color, monto, nombre, teléfono),
ve el QR de Yape/Plin de la sala y abre WhatsApp con el mensaje ya escrito en el
formato exacto que el cajero pega para autocompletar (R18). Además hay un botón
de consultas por WhatsApp visible (R29).

## Alcance

### API

- `buildBetMessage({ roomName, side, amountCentimos, playerName, phone })` en
  `lib/betMessage.js` (junto a `parseBetMessage`: el formato vive en un solo
  lugar — generar y parsear son dos caras del mismo contrato):
  `APUESTA · Sala GENERAL · ROJO · S/ 10.00 · Juan Pérez · 987654321`
- `GET /rooms/:code/bet-message` (público): query `side` (red|blue, opcional),
  `amountCentimos` (int >0), `playerName`, `phone` — validados con Zod.
  Devuelve `{ message, whatsappUrl }` donde `whatsappUrl` =
  `https://wa.me/<whatsapp-de-la-sala>?text=<mensaje-codificado>`. Sin color,
  el mensaje omite el segmento (bandeja "sin color", R22).

### Web — `/sala/[code]`

- Sección "Arma tu apuesta": nombre y apellido, teléfono, selector de color
  (rojo/azul), monto en S/ (validado contra `min/maxBetCentimos` de la sala),
  y método (Yape | Plin).
- QR del método elegido (`room.yapeQr` / `plinQr`): si el valor guardado es
  una URL se muestra como imagen; si es un payload se renderiza con el paquete
  `qrcode` a data-URL.
- Botón "Enviar por WhatsApp": consulta `bet-message` y abre `whatsappUrl` en
  pestaña nueva (desactivado hasta que el formulario sea válido).
- Botón flotante "Consultas" de WhatsApp (R29): `wa.me/<whatsapp>` sin
  mensaje, visible en `/sala/[code]`.

## Fuera de alcance

Reglas/calculadora/verificador (011), reportes (012), simulador (013).

## Criterios de aceptación

- AC-01 `buildBetMessage` produce el formato exacto R18 y `parseBetMessage`
  extrae `side`, `amountCentimos`, `playerName` y `phone` de ese mensaje
  (round-trip).
- AC-02 Sin `side`, el mensaje no contiene "ROJO"/"AZUL" y `parseBetMessage`
  devuelve `side` ausente.
- AC-03 `GET /rooms/:code/bet-message` devuelve `message` y `whatsappUrl` con
  el número de la sala y el texto codificado; 400 con parámetros inválidos;
  404 con sala inexistente.

## Verificación

Tests `api/test/betMessage.test.js`; web lint+build; smoke: armar una apuesta
en `/sala/GENERAL` y comprobar que el mensaje generado parsea.
