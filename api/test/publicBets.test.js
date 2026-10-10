import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";

import { createApp } from "../src/app.js";
import { ROLES, User } from "../src/models/user.js";
import { Bet, Round } from "../src/models/round.js";
import { Room, RoomSlot } from "../src/models/room.js";
import { ensureAdmin, ensureGeneralRoom } from "../src/bootstrap.js";
import { sequelize } from "../src/db.js";

let server;
let base;
let adminToken;
let roomSeq = 0;
let opSeq = 0;

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function makeRoom() {
  const created = await api("/admin/rooms", {
    method: "POST",
    body: { name: `Sala P${++roomSeq}` },
    token: adminToken,
  });
  assert.equal(created.status, 201);
  return created.body.room;
}

async function bet(code, fields) {
  const res = await api(`/rooms/${code}/bets`, {
    method: "POST",
    body: {
      side: "red",
      amountCentimos: 1000,
      playerName: "Jugador Prueba",
      phone: "987654321",
      method: "yape",
      operationNumber: `op-${++opSeq}`,
      paymentVerified: true,
      ...fields,
    },
    token: adminToken,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.bets[0];
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

  server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  adminToken = (
    await api("/auth/login", {
      method: "POST",
      body: { username: "admin", password: "admin1234" },
    })
  ).body.token;
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

test("AC-03: lista pública enmascarada, sin datos sensibles", async () => {
  const { code } = await makeRoom();
  await bet(code, {
    playerName: "Rosa María Quispe",
    phone: "987654321",
    operationNumber: "SECRETOP-1",
  });
  const res = await api(`/rooms/${code}/public-bets`);
  assert.equal(res.status, 200);
  const [item] = res.body.bets;
  assert.equal(item.displayName, "Rosa Q.");
  assert.equal(item.maskedPhone, "*** *** 321");
  assert.equal(item.amountCentimos, 1000);
  assert.equal(item.side, "red");
  assert.ok(item.createdAt);
  // sin datos sensibles del cajero ni del pago
  for (const k of ["operationNumber", "paymentVerified", "cashierId", "annulReason"]) {
    assert.equal(item[k], undefined, `expuso ${k}`);
  }
  const raw = JSON.stringify(res.body);
  assert.ok(!raw.includes("SECRETOP-1"));
  assert.ok(!raw.includes("987654321"));
  assert.ok(!raw.includes("Quispe"));
});

test("AC-04/05: rango de ganancia por color; sin color y anuladas", async () => {
  const { code } = await makeRoom();
  await bet(code, { side: "red", amountCentimos: 1000 });
  await bet(code, { side: "blue", amountCentimos: 500 });
  const noColor = await bet(code, { side: null });
  const anulada = await bet(code, { side: "red" });
  const annul = await api(`/rooms/${code}/bets/${anulada.id}/annul`, {
    method: "POST",
    body: { reason: "error" },
    token: adminToken,
  });
  assert.equal(annul.status, 200);

  const res = await api(`/rooms/${code}/public-bets`);
  const bets = res.body.bets;
  assert.equal(bets.length, 3, "sin la anulada");
  const red = bets.find((b) => b.side === "red");
  const blue = bets.find((b) => b.side === "blue");
  const pending = bets.find((b) => b.id === noColor.id);
  assert.deepEqual(red.winRangeCentimos, { min: 1500, max: 1900 });
  assert.deepEqual(blue.winRangeCentimos, { min: 750, max: 950 });
  assert.equal(pending.side, null);
  assert.equal(pending.winRangeCentimos, null);
});

test("AC-06: blocked y missing por color en la vista de ronda", async () => {
  const { code } = await makeRoom();
  // sin apuestas: nada bloqueado
  let round = (await api(`/rooms/${code}/round`)).body.round;
  assert.deepEqual(round.blocked, { red: false, blue: false });
  assert.equal(round.missing.red, null);

  // roja grande que queda en cola por falta del azul
  await bet(code, { side: "red", amountCentimos: 5000 });
  await bet(code, { side: "blue", amountCentimos: 100 });
  // azul chica para que la segunda roja no entre por seguridad
  await bet(code, { side: "red", amountCentimos: 4000 });
  round = (await api(`/rooms/${code}/round`)).body.round;
  // ambos colores con cola esperando → ambos bloqueados (R13)
  assert.equal(round.blocked.red, true);
  assert.equal(round.blocked.blue, true);
  assert.ok(round.missing.red === null || round.missing.red.min >= 0);
});

test("AC-03b: sala inexistente → 404 en /public-bets", async () => {
  const res = await api(`/rooms/NOPE99/public-bets`);
  assert.equal(res.status, 404);
});
