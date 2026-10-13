import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";

import { createApp } from "../src/app.js";
import { buildBetMessage, parseBetMessage } from "../src/lib/betMessage.js";
import { User } from "../src/models/user.js";
import { Bet, Round } from "../src/models/round.js";
import { Room, RoomSlot } from "../src/models/room.js";
import { ensureAdmin, ensureGeneralRoom } from "../src/bootstrap.js";
import { sequelize } from "../src/db.js";

test("AC-01: buildBetMessage genera el formato R18 y parseBetMessage lo lee completo", () => {
  const message = buildBetMessage({
    roomName: "GENERAL",
    side: "red",
    amountCentimos: 1000,
    playerName: "Juan Pérez",
    phone: "987654321",
  });
  assert.equal(
    message,
    "APUESTA · Sala GENERAL · ROJO · S/ 10.00 · Juan Pérez · 987654321",
  );
  const parsed = parseBetMessage(message);
  assert.equal(parsed.side, "red");
  assert.equal(parsed.amountCentimos, 1000);
  assert.equal(parsed.playerName, "Juan Pérez");
  assert.equal(parsed.phone, "987654321");
});

test("AC-02: sin color el mensaje lo omite y el parser no asigna side", () => {
  const message = buildBetMessage({
    roomName: "GENERAL",
    side: null,
    amountCentimos: 2500,
    playerName: "Ana Ruiz",
    phone: "912345678",
  });
  assert.equal(message, "APUESTA · Sala GENERAL · S/ 25.00 · Ana Ruiz · 912345678");
  const parsed = parseBetMessage(message);
  assert.equal(parsed.side, undefined);
  assert.equal(parsed.amountCentimos, 2500);
  assert.equal(parsed.playerName, "Ana Ruiz");
});

// Endpoint público GET /rooms/:code/bet-message
let server;
let base;

async function api(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

before(async () => {
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "admin1234";
  await Bet.destroy({ where: {} });
  await Round.destroy({ where: {} });
  await RoomSlot.destroy({ where: {} });
  await Room.destroy({ where: {} });
  await User.destroy({ where: {} });
  await ensureAdmin();
  await ensureGeneralRoom();
  await Room.update(
    { whatsapp: "51999888777" },
    { where: { code: "GENERAL" } },
  );

  server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await Bet.destroy({ where: {} });
  await Round.destroy({ where: {} });
  await RoomSlot.destroy({ where: {} });
  await Room.destroy({ where: {} });
  await User.destroy({ where: {} });
  await sequelize.close();
});

test("AC-03: /bet-message devuelve mensaje y wa.me con el número de la sala", async () => {
  const res = await api(
    "/rooms/GENERAL/bet-message?side=blue&amountCentimos=2000&playerName=Juan%20P%C3%A9rez&phone=987654321",
  );
  assert.equal(res.status, 200);
  assert.equal(
    res.body.message,
    "APUESTA · Sala GENERAL · AZUL · S/ 20.00 · Juan Pérez · 987654321",
  );
  const url = new URL(res.body.whatsappUrl);
  assert.equal(url.origin + url.pathname, "https://wa.me/51999888777");
  assert.equal(decodeURIComponent(url.searchParams.get("text")), res.body.message);
});

test("AC-03b: parámetros inválidos → 400; sala inexistente → 404", async () => {
  const bad = await api("/rooms/GENERAL/bet-message?side=verde&amountCentimos=1000&playerName=A&phone=9");
  assert.equal(bad.status, 400);
  const noRoom = await api("/rooms/NOPE99/bet-message?side=red&amountCentimos=1000&playerName=A&phone=999888777");
  assert.equal(noRoom.status, 404);
});
