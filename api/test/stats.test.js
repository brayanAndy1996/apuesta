import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

import { createApp } from "../src/app.js";
import { drawSlot } from "../src/domain/draw.js";
import { seedHash } from "../src/lib/seed.js";
import { User } from "../src/models/user.js";
import { Bet, Round } from "../src/models/round.js";
import { Room, RoomSlot } from "../src/models/room.js";
import { ensureAdmin, ensureGeneralRoom } from "../src/bootstrap.js";
import { processExpiredRounds } from "../src/services/roundService.js";
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
    body: { name: `Sala S${++roomSeq}` },
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
}

async function liquidate(code) {
  const endsAt = (await api(`/rooms/${code}/round`)).body.round.countdownEndsAt;
  await processExpiredRounds(new Date(Date.parse(endsAt) + 10));
  const spinning = await Round.findOne({
    include: [{ model: Room, as: "room", where: { code } }],
    order: [["seq", "DESC"]],
  });
  await processExpiredRounds(new Date(spinning.girandoEndsAt.getTime() + 10));
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

test("AC-01: sin rondas liquidadas devuelve rounds:0 y realPct null", async () => {
  const { code } = await makeRoom();
  const res = await api(`/rooms/${code}/stats`);
  assert.equal(res.status, 200);
  assert.equal(res.body.rounds, 0);
  assert.equal(res.body.perColor.red + res.body.perColor.blue, 0);
  assert.ok(res.body.slots.length > 0);
  assert.equal(res.body.slots[0].realPct, null);
  assert.equal(res.body.slots[0].realCount, 0);
});

test("AC-02/03: tras liquidar, realCount y perColor coinciden con el sorteo", async () => {
  const { code } = await makeRoom();
  await bet(code, { side: "red", amountCentimos: 1000 });
  await bet(code, { side: "blue", amountCentimos: 1000 });
  await liquidate(code);
  // segunda ronda: hacen falta apuestas nuevas para arrancar la cuenta regresiva
  await bet(code, { side: "red", amountCentimos: 1000 });
  await bet(code, { side: "blue", amountCentimos: 1000 });
  await liquidate(code);

  const res = await api(`/rooms/${code}/stats`);
  assert.equal(res.status, 200);
  assert.equal(res.body.rounds, 2);
  assert.equal(res.body.perColor.red + res.body.perColor.blue, 2);
  const realTotal = res.body.slots.reduce((a, s) => a + s.realCount, 0);
  assert.equal(realTotal, 2);
  for (const s of res.body.slots) {
    assert.equal(s.expectedPct, s.weight);
    assert.ok(typeof s.multiplier === "number" && typeof s.side === "string");
  }
});

test("AC-04: la verificación reproduce drawSlot y seedHash (vector real)", async () => {
  const { code } = await makeRoom();
  await bet(code, { side: "red", amountCentimos: 1000 });
  await bet(code, { side: "blue", amountCentimos: 1000 });
  await liquidate(code);

  const rounds = (await api(`/rooms/${code}/rounds`)).body.rounds;
  const r = rounds.find((x) => x.state === "LIQUIDADA");
  assert.ok(r.seed && r.seedHash && r.result);

  // sha256(seed) === seedHash publicado (como hará el navegador)
  const recomputed = createHash("sha256").update(r.seed).digest("hex");
  assert.equal(recomputed, r.seedHash);
  assert.equal(recomputed, seedHash(r.seed));

  // BigInt(seed) % 100 sobre el orden canónico → casilla oficial
  const slots = await (
    await Room.findOne({ where: { code } })
  ).getSlots();
  const { slot, pos } = drawSlot(r.seed, slots);
  assert.equal(slot.id, r.result.id);
  assert.equal(Number(BigInt(`0x${r.seed}`) % 100n), pos);
});
