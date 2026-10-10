import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { createApp } from "../src/app.js";
import { ensureAdmin, ensureGeneralRoom } from "../src/bootstrap.js";
import { sequelize } from "../src/db.js";
import { hashCredential } from "../src/lib/crypto.js";
import { seedHash } from "../src/lib/seed.js";
import { Room, RoomSlot } from "../src/models/room.js";
import { Bet, ROUND_STATES, Round } from "../src/models/round.js";
import { ROLES, User } from "../src/models/user.js";
import { processExpiredRounds } from "../src/services/roundService.js";

let server;
let base;
let adminToken;
let cashier;
let cashierToken;
let room; // sala con cajero asignado
let roomSeq = 0;

const now = () => new Date();
const inMs = (ms) => new Date(Date.now() + ms);

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function makeRoom() {
  const created = await api("/admin/rooms", {
    method: "POST",
    body: { name: `Sala R${++roomSeq}` },
    token: adminToken,
  });
  assert.equal(created.status, 201);
  return created.body.room;
}

async function bet(code, side, amountCentimos, token = adminToken) {
  return api(`/rooms/${code}/bets`, {
    method: "POST",
    body: { side, amountCentimos },
    token,
  });
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

  cashier = await User.create({
    role: ROLES.CASHIER,
    username: "cajero.rondas",
    name: "Cajero Rondas",
    credentialHash: await hashCredential("1234"),
  });

  server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  adminToken = (
    await api("/auth/login", {
      method: "POST",
      body: { username: "admin", password: "admin1234" },
    })
  ).body.token;
  cashierToken = (
    await api("/auth/pin", {
      method: "POST",
      body: { username: "cajero.rondas", pin: "1234" },
    })
  ).body.token;

  const created = await api("/admin/rooms", {
    method: "POST",
    body: { name: "Sala Cajero", cashierId: cashier.id },
    token: adminToken,
  });
  assert.equal(created.status, 201);
  room = created.body.room;
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

test("AC-01: la primera apuesta crea la ronda en ESPERANDO y queda en cola", async () => {
  const res = await bet(room.code, "red", 600);
  assert.equal(res.status, 201);
  assert.equal(res.body.bet.status, "QUEUED");
  assert.equal(res.body.round.seq, 1);
  assert.equal(res.body.round.state, "ESPERANDO");

  const view = await api(`/rooms/${room.code}/round`);
  assert.equal(view.status, 200);
  assert.equal(view.body.round.state, "ESPERANDO");
  assert.deepEqual(view.body.round.pools, { red: 0, blue: 0 });
  assert.deepEqual(view.body.round.queued, { red: 600, blue: 0 });
  assert.ok(view.body.round.seedHash);
});

test("AC-02: apuestas de ambos colores entran a la bolsa y arranca la cuenta", async () => {
  const other = await makeRoom();
  const blue = await bet(other.code, "blue", 600);
  assert.equal(blue.body.bet.status, "QUEUED");
  const red = await bet(other.code, "red", 600);
  assert.equal(red.status, 201);

  const view = await api(`/rooms/${other.code}/round`);
  assert.equal(view.body.round.state, "CUENTA_REGRESIVA");
  assert.deepEqual(view.body.round.pools, { red: 600, blue: 600 });
  assert.ok(Date.parse(view.body.round.countdownEndsAt) > Date.now() + 55_000);
  assert.ok(Date.parse(view.body.round.maxEndsAt) > Date.now() + 295_000);

  const poolBets = await Bet.findAll({
    where: { status: "POOL" },
    include: [{ model: Round, as: "round", where: { roomId: other.id } }],
  });
  assert.equal(poolBets.length, 2);
});

test("AC-03: cada admisión a la bolsa reinicia la cuenta regresiva", async () => {
  const code = (await makeRoom()).code;
  await bet(code, "red", 2000);
  await bet(code, "blue", 2000);
  const first = (await api(`/rooms/${code}/round`)).body.round;
  const t1 = Date.parse(first.countdownEndsAt);

  await new Promise((r) => setTimeout(r, 60));
  await bet(code, "blue", 200); // entra: 2200 azul vs 2000 rojo sigue segura

  const second = (await api(`/rooms/${code}/round`)).body.round;
  assert.equal(second.state, "CUENTA_REGRESIVA");
  assert.ok(Date.parse(second.countdownEndsAt) > t1);
  assert.deepEqual(second.pools, { red: 2000, blue: 2200 });
});

test("AC-04: al vencer la cuenta gira 7 s, se liquida y abre la siguiente", async () => {
  const code = (await makeRoom()).code;
  await bet(code, "red", 600);
  await bet(code, "blue", 600);
  const round = await Round.findOne({
    include: [{ model: Room, as: "room", where: { code } }],
  });

  const res1 = await processExpiredRounds(new Date(Date.parse(
    (await api(`/rooms/${code}/round`)).body.round.countdownEndsAt,
  ) + 10));
  assert.ok(res1.some((r) => r.roundId === round.id && r.action === "closed"));
  await round.reload();
  assert.equal(round.state, "GIRANDO");
  assert.ok(round.girandoEndsAt);

  const res2 = await processExpiredRounds(new Date(round.girandoEndsAt.getTime() + 10));
  assert.ok(res2.some((r) => r.roundId === round.id && r.action === "liquidated"));
  await round.reload();
  assert.equal(round.state, "LIQUIDADA");
  assert.ok(round.seed); // semilla revelada tras liquidar
  assert.equal(seedHash(round.seed), round.seedHash);

  const next = await Round.findOne({
    where: { roomId: round.roomId, state: [...Object.values(ROUND_STATES)].slice(0, 3) },
  });
  assert.equal(next.seq, round.seq + 1);
  assert.equal(next.state, "ESPERANDO");
});

test("AC-05: la cola en espera se arrastra a la ronda siguiente (R17)", async () => {
  const code = (await makeRoom()).code;
  await bet(code, "red", 600);
  await bet(code, "blue", 600);
  await bet(code, "red", 5000); // queda en cola: desequilibra la bolsa

  const round = await Round.findOne({
    include: [{ model: Room, as: "room", where: { code } }],
    order: [["seq", "DESC"]],
  });
  round.state = "GIRANDO";
  round.girandoEndsAt = inMs(-1);
  round.countdownEndsAt = null;
  await round.save();

  await processExpiredRounds(now());
  const next = await Round.findOne({
    where: { roomId: round.roomId, state: "ESPERANDO" },
  });
  assert.equal(next.seq, round.seq + 1);

  const carried = await Bet.findAll({
    where: { roundId: next.id, status: "QUEUED" },
    order: [["seq", "ASC"]],
  });
  assert.equal(carried.length, 1);
  assert.equal(carried[0].amountCentimos, 5000);
  assert.equal(carried[0].side, "red");
});

test("AC-06: al máximo se iguala arrastrando parte de una apuesta y gira", async () => {
  const code = (await makeRoom()).code;
  await bet(code, "red", 3000);
  await bet(code, "blue", 2000);
  await bet(code, "blue", 1200); // entra rojo; azul queda [2000, 1200] en cola

  let view = (await api(`/rooms/${code}/round`)).body.round;
  assert.deepEqual(view.pools, { red: 3000, blue: 0 });

  const round = await Round.findOne({
    include: [{ model: Room, as: "room", where: { code } }],
    order: [["seq", "DESC"]],
  });
  await processExpiredRounds(new Date(round.maxEndsAt.getTime() + 10));

  await round.reload();
  assert.equal(round.state, "GIRANDO");
  assert.equal(round.poolBlueCentimos, 3000);

  const bets = await Bet.findAll({
    where: { roundId: round.id },
    order: [["seq", "ASC"], ["createdAt", "ASC"]],
  });
  const blue2000 = bets.find((b) => b.side === "blue" && b.seq === 2);
  const blue1200 = bets.filter((b) => b.side === "blue" && b.seq === 3);
  assert.equal(blue2000.status, "POOL");
  assert.equal(blue2000.amountCentimos, 2000);
  // el de 1200 se partió: 1000 entró a la bolsa y 200 sigue en cola
  const queuedPart = blue1200.find((b) => b.status === "QUEUED");
  const poolPart = blue1200.find((b) => b.status === "POOL");
  assert.equal(queuedPart.amountCentimos, 200);
  assert.equal(poolPart.amountCentimos, 1000);
  assert.equal(poolPart.parentBetId, queuedPart.id);
});

test("AC-07: bolsa insegura pausa la cuenta y la reanuda con lo que quedaba", async () => {
  const code = (await makeRoom()).code;
  await bet(code, "red", 3000);
  await bet(code, "blue", 2000);
  await bet(code, "blue", 1000);

  let view = (await api(`/rooms/${code}/round`)).body.round;
  assert.equal(view.state, "PAUSADA");
  assert.equal(view.countdownEndsAt, null);

  // Simular que venía contando: guardamos 30 s restantes.
  const round = await Round.findOne({
    include: [{ model: Room, as: "room", where: { code } }],
    order: [["seq", "DESC"]],
  });
  round.countdownRemainingMs = 30_000;
  // Estado alcanzable: pool 2700/1400 con frente azul 1200 que sí puede entrar.
  round.poolRedCentimos = 2700;
  round.poolBlueCentimos = 1400;
  await Bet.destroy({ where: { roundId: round.id } });
  await Bet.create({
    roundId: round.id, seq: 1, side: "blue", amountCentimos: 1200, status: "QUEUED",
  });
  await round.save();

  const before = Date.now();
  const res = await bet(code, "red", 100);
  assert.equal(res.status, 201);

  view = (await api(`/rooms/${code}/round`)).body.round;
  assert.equal(view.state, "CUENTA_REGRESIVA");
  const ends = Date.parse(view.countdownEndsAt);
  assert.ok(ends > before + 28_000 && ends < before + 32_000);
});

test("AC-08: una apuesta durante GIRANDO va a la ronda siguiente", async () => {
  const code = (await makeRoom()).code;
  await bet(code, "red", 600);
  await bet(code, "blue", 600);
  const spinning = await Round.findOne({
    include: [{ model: Room, as: "room", where: { code } }],
  });
  spinning.state = "GIRANDO";
  spinning.girandoEndsAt = inMs(60_000);
  spinning.countdownEndsAt = null;
  await spinning.save();

  const res = await bet(code, "red", 300);
  assert.equal(res.status, 201);
  assert.equal(res.body.round.seq, spinning.seq + 1);

  await processExpiredRounds(inMs(61_000));
  const next = await Round.findByPk(res.body.bet.id && res.body.round.seq
    ? (await Bet.findByPk(res.body.bet.id)).roundId
    : null);
  assert.equal(next.seq, spinning.seq + 1);
  assert.equal(next.state, "ESPERANDO");
});

test("AC-09: permisos y validación de la apuesta provisional", async () => {
  const anon = await api(`/rooms/${room.code}/bets`, {
    method: "POST",
    body: { side: "red", amountCentimos: 200 },
  });
  assert.equal(anon.status, 401);

  await User.create({
    role: ROLES.CASHIER,
    username: "cajero.ajeno",
    name: "Ajeno",
    credentialHash: await hashCredential("9999"),
  });
  const otherToken = (
    await api("/auth/pin", {
      method: "POST",
      body: { username: "cajero.ajeno", pin: "9999" },
    })
  ).body.token;
  const foreign = await bet(room.code, "red", 200, otherToken);
  assert.equal(foreign.status, 403);

  const tooHigh = await bet(room.code, "red", 99_999);
  assert.equal(tooHigh.status, 422);
  const badSide = await api(`/rooms/${room.code}/bets`, {
    method: "POST",
    body: { side: "green", amountCentimos: 200 },
    token: cashierToken,
  });
  assert.equal(badSide.status, 400);
});
