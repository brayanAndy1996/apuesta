import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";

import { createApp } from "../src/app.js";
import { ensureAdmin, ensureGeneralRoom } from "../src/bootstrap.js";
import { sequelize } from "../src/db.js";
import { hashCredential } from "../src/lib/crypto.js";
import { Bet, Round } from "../src/models/round.js";
import { Room, RoomSlot } from "../src/models/room.js";
import { ROLES, User } from "../src/models/user.js";

let server;
let base;
let adminToken;
let otherCashierToken;
let roomSeq = 0;

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
    body: { name: `Sala SIM${++roomSeq}` },
    token: adminToken,
  });
  assert.equal(created.status, 201);
  return created.body.room;
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

  // Cajero sin sala asignada: NO debe poder simular en salas ajenas.
  const foreign = await Room.create({ name: "Otra", code: "OTRA99" });
  await User.create({
    role: ROLES.CASHIER,
    username: "cajero.ajeno",
    name: "Cajero Ajeno",
    credentialHash: await hashCredential("1234"),
    roomId: foreign.id,
  });
  otherCashierToken = (
    await api("/auth/pin", {
      method: "POST",
      body: { username: "cajero.ajeno", pin: "1234" },
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

test("AC-01: simulate registra apuestas ficticias marcadas", async () => {
  const { code } = await makeRoom();
  const res = await api(`/rooms/${code}/simulate`, {
    method: "POST",
    body: { count: 3 },
    token: adminToken,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.bets.length, 3);
  for (const b of res.body.bets) {
    assert.match(b.operationNumber, /^SIM-/);
    assert.equal(b.paymentVerified, true);
    assert.equal(b.isSimulated, true);
    assert.ok(b.playerName && b.playerName.length > 0);
    assert.ok(b.phone.length > 0);
  }
});

test("AC-02: las simuladas entran a la bolsa/cola normal", async () => {
  const { code } = await makeRoom();
  await api(`/rooms/${code}/simulate`, {
    method: "POST",
    body: { count: 2, side: "red" },
    token: adminToken,
  });
  await api(`/rooms/${code}/simulate`, {
    method: "POST",
    body: { count: 2, side: "blue" },
    token: adminToken,
  });
  const round = (await api(`/rooms/${code}/round`)).body.round;
  assert.ok(round.pools.red > 0 || round.queued.red > 0);
  assert.ok(round.pools.blue > 0 || round.queued.blue > 0);
});

test("AC-03: side fuerza el color; sin side se reparten", async () => {
  const { code } = await makeRoom();
  const forced = await api(`/rooms/${code}/simulate`, {
    method: "POST",
    body: { count: 4, side: "blue" },
    token: adminToken,
  });
  assert.equal(forced.status, 201);
  assert.ok(forced.body.bets.every((b) => b.side === "blue"));

  const spread = await api(`/rooms/${code}/simulate`, {
    method: "POST",
    body: { count: 10 },
    token: adminToken,
  });
  assert.equal(spread.status, 201);
  const sides = new Set(spread.body.bets.map((b) => b.side));
  assert.equal(sides.size, 2); // alterna → ambos colores
});

test("AC-04: validaciones — count fuera de rango, sin auth, cajero ajeno", async () => {
  const { code } = await makeRoom();
  for (const count of [0, 21, -1, "tres"]) {
    const res = await api(`/rooms/${code}/simulate`, {
      method: "POST",
      body: { count },
      token: adminToken,
    });
    assert.equal(res.status, 400, `count=${count}`);
  }
  const noAuth = await api(`/rooms/${code}/simulate`, {
    method: "POST",
    body: { count: 1 },
  });
  assert.equal(noAuth.status, 401);
  const foreign = await api(`/rooms/${code}/simulate`, {
    method: "POST",
    body: { count: 1 },
    token: otherCashierToken,
  });
  assert.equal(foreign.status, 403);
});

test("AC-05: public-bets marca isSimulated", async () => {
  const { code } = await makeRoom();
  await api(`/rooms/${code}/simulate`, {
    method: "POST",
    body: { count: 2 },
    token: adminToken,
  });
  const real = await api(`/rooms/${code}/bets`, {
    method: "POST",
    body: {
      side: "red",
      amountCentimos: 1000,
      playerName: "Real Jugador",
      phone: "987654321",
      method: "yape",
      operationNumber: "op-real-1",
      paymentVerified: true,
    },
    token: adminToken,
  });
  assert.equal(real.status, 201);
  const pub = await api(`/rooms/${code}/public-bets`);
  assert.equal(pub.status, 200);
  const sims = pub.body.bets.filter((b) => b.isSimulated);
  const reals = pub.body.bets.filter((b) => !b.isSimulated);
  assert.ok(sims.length >= 2);
  assert.equal(reals.length, 1);
});

test("AC-05b: montos dentro de los topes de la sala", async () => {
  const { code, minBetCentimos, maxBetCentimos } = await makeRoom();
  const res = await api(`/rooms/${code}/simulate`, {
    method: "POST",
    body: { count: 15 },
    token: adminToken,
  });
  assert.equal(res.status, 201);
  for (const b of res.body.bets) {
    assert.ok(b.amountCentimos >= minBetCentimos, `${b.amountCentimos} < min`);
    assert.ok(
      b.amountCentimos <= maxBetCentimos,
      `${b.amountCentimos} > max`,
    );
  }
});
