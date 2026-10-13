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
import { processExpiredRounds } from "../src/services/roundService.js";

let server;
let base;
let adminToken;
let cashierToken;
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
    body: { name: `Sala R${++roomSeq}` },
    token: adminToken,
  });
  assert.equal(created.status, 201);
  return created.body.room;
}

async function bet(code, fields = {}) {
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
  return res.body.bets;
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

const todayLima = () => {
  // YYYY-MM-DD en America/Lima (fijo -05:00, sin DST).
  const now = new Date();
  const lima = new Date(now.getTime() - 5 * 3600 * 1000);
  return lima.toISOString().slice(0, 10);
};

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

  await User.create({
    role: ROLES.CASHIER,
    username: "cajero.reportes",
    name: "Cajero Reportes",
    credentialHash: await hashCredential("1234"),
    roomId: (await Room.findOne({ where: { code: "GENERAL" } })).id,
  });
  cashierToken = (
    await api("/auth/pin", {
      method: "POST",
      body: { username: "cajero.reportes", pin: "1234" },
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

test("AC-01: el reporte del día agrega recibido/pagado/devuelto/anulado", async () => {
  const { code } = await makeRoom();
  // ronda 1: rojo 1000 + azul 1000 → gira y liquida
  await bet(code, { side: "red", amountCentimos: 1000 });
  await bet(code, { side: "blue", amountCentimos: 1000 });
  await liquidate(code);
  // ronda 2: rojo 2500 + azul 1500 (deadlock: quedan en cola);
  // además una anulada y una devuelta para probar esos montos
  await bet(code, { side: "red", amountCentimos: 2500 });
  const [refunded] = await bet(code, { side: "blue", amountCentimos: 1500 });
  const [anulled] = await bet(code, { side: "blue", amountCentimos: 700 });
  const anulRes = await api(`/rooms/${code}/bets/${anulled.id}/annul`, {
    method: "POST",
    body: { reason: "monto equivocado" },
    token: adminToken,
  });
  assert.equal(anulRes.status, 200);
  const refundRes = await api(`/rooms/${code}/bets/${refunded.id}/refund`, {
    method: "POST",
    body: { refundOperationNumber: "dev-1" },
    token: adminToken,
  });
  assert.equal(refundRes.status, 200);

  const date = todayLima();
  const res = await api(`/admin/reports/daily?code=${code}&date=${date}`, {
    token: adminToken,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const r = res.body;
  assert.equal(r.rounds, 2); // la ronda 2 sigue abierta pero es del día
  // recibido = todo lo registrado: 1000+1000 + 2500+1500+700
  assert.equal(r.collectedCentimos, 6700);
  assert.equal(r.annulledCentimos, 700);
  assert.equal(r.annulledCount, 1);
  assert.equal(r.refundedCentimos, 1500);
  assert.equal(r.refundedCount, 1);
  // invariante R26 por el reporte: collected = pooled + carried + anulled + refunded
  assert.equal(
    r.collectedCentimos,
    r.pooledCentimos + r.carriedCentimos + r.annulledCentimos + r.refundedCentimos,
  );
  // ronda 1 liquidada: 2000 en bolsa; su premio está en payouts
  assert.equal(r.payoutsCentimos > 0, true);
  assert.equal(r.winners.total >= 1, true);
  // marcar un premio pagado
  const winners = (
    await api(`/rooms/${code}/winners`, { token: adminToken })
  ).body.winners;
  assert.ok(winners.length >= 1);
  const pay = await api(`/rooms/${code}/bets/${winners[0].betId}/pay`, {
    method: "POST",
    body: { operationNumber: "pago-9" },
    token: adminToken,
  });
  assert.equal(pay.status, 200);
  const res2 = await api(`/admin/reports/daily?code=${code}&date=${date}`, {
    token: adminToken,
  });
  assert.equal(res2.body.winners.paid, 1);
  assert.equal(res2.body.winners.pending, res2.body.winners.total - 1);
  assert.equal(res2.body.payoutsPaidCentimos, winners[0].payoutCentimos);
});

test("AC-02: el borde de día es America/Lima", async () => {
  const { code } = await makeRoom();
  await bet(code, { side: "red", amountCentimos: 1000 });
  const round = await Round.findOne({
    include: [{ model: Room, as: "room", where: { code } }],
    order: [["seq", "DESC"]],
  });
  // 23:55 Lima = 04:55 UTC del día siguiente
  await Round.update(
    { createdAt: new Date("2026-10-11T04:55:00Z") },
    { where: { id: round.id } },
  );
  const r1 = await api(
    `/admin/reports/daily?code=${code}&date=2026-10-10`,
    { token: adminToken },
  );
  assert.equal(r1.body.rounds, 1);
  const r2 = await api(
    `/admin/reports/daily?code=${code}&date=2026-10-11`,
    { token: adminToken },
  );
  assert.equal(r2.body.rounds, 0);
});

test("AC-03: auditoría lista anular/devolver/pagar con actor y hora", async () => {
  const { code } = await makeRoom();
  const [b1] = await bet(code, { side: "blue", amountCentimos: 500 });
  const [b2] = await bet(code, { side: "blue", amountCentimos: 600 });
  await api(`/rooms/${code}/bets/${b1.id}/annul`, {
    method: "POST",
    body: { reason: "duplicada" },
    token: adminToken,
  });
  await api(`/rooms/${code}/bets/${b2.id}/refund`, {
    method: "POST",
    body: { refundOperationNumber: "dev-77" },
    token: adminToken,
  });
  // liquidar para tener un premio que pagar
  await bet(code, { side: "red", amountCentimos: 1000 });
  await bet(code, { side: "blue", amountCentimos: 1000 });
  await liquidate(code);
  const winners = (
    await api(`/rooms/${code}/winners`, { token: adminToken })
  ).body.winners;
  await api(`/rooms/${code}/bets/${winners[0].betId}/pay`, {
    method: "POST",
    body: { operationNumber: "pago-1" },
    token: adminToken,
  });

  const res = await api(
    `/admin/audit?code=${code}&date=${todayLima()}`,
    { token: adminToken },
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const types = res.body.events.map((e) => e.type);
  assert.ok(types.includes("ANULADA"));
  assert.ok(types.includes("DEVUELTA"));
  assert.ok(types.includes("PAGADA"));

  const anul = res.body.events.find((e) => e.type === "ANULADA");
  assert.equal(anul.detail, "duplicada");
  assert.equal(anul.actor.name, "Administrador");
  const dev = res.body.events.find((e) => e.type === "DEVUELTA");
  assert.equal(dev.detail, "dev-77");
  const pago = res.body.events.find((e) => e.type === "PAGADA");
  assert.equal(pago.detail, "pago-1");
  assert.equal(pago.payoutCentimos > 0, true);

  // orden descendente por hora
  const times = res.body.events.map((e) => Date.parse(e.at));
  const sorted = [...times].sort((a, b) => b - a);
  assert.deepEqual(times, sorted);
});

test("AC-04: solo admin accede a reportes y auditoría", async () => {
  const { code } = await makeRoom();
  const date = todayLima();
  for (const path of [
    `/admin/reports/daily?code=${code}&date=${date}`,
    `/admin/audit?code=${code}&date=${date}`,
  ]) {
    assert.equal((await api(path)).status, 401);
    assert.equal((await api(path, { token: cashierToken })).status, 403);
    assert.equal((await api(path, { token: adminToken })).status, 200);
  }
});

test("AC-05: date inválida → 400, sala inexistente → 404", async () => {
  const bad = await api("/admin/reports/daily?code=GENERAL&date=ayer", {
    token: adminToken,
  });
  assert.equal(bad.status, 400);
  const missing = await api(
    "/admin/reports/daily?code=NOPE99&date=2026-10-10",
    { token: adminToken },
  );
  assert.equal(missing.status, 404);
  const badAudit = await api("/admin/audit?code=GENERAL&date=2026-13-40", {
    token: adminToken,
  });
  assert.equal(badAudit.status, 400);
});
