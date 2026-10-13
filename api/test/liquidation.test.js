import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";

import { createApp } from "../src/app.js";
import { hashCredential } from "../src/lib/crypto.js";
import { ROLES, User } from "../src/models/user.js";
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
    body: { name: `Sala L${++roomSeq}` },
    token: adminToken,
  });
  assert.equal(created.status, 201);
  return created.body.room;
}

async function bet(code, fields, token = adminToken) {
  return api(`/rooms/${code}/bets`, {
    method: "POST",
    body: {
      side: "red",
      amountCentimos: 1000,
      playerName: "Jugador Test",
      phone: "987654321",
      method: "yape",
      operationNumber: `op-${++opSeq}`,
      paymentVerified: true,
      ...fields,
    },
    token,
  });
}

// Corre la ronda hasta LIQUIDADA forzando los temporizadores.
async function liquidate(code) {
  const endsAt = (await api(`/rooms/${code}/round`)).body.round.countdownEndsAt;
  await processExpiredRounds(new Date(Date.parse(endsAt) + 10));
  const spinning = await Round.findOne({
    include: [{ model: Room, as: "room", where: { code } }],
    order: [["seq", "DESC"]],
  });
  await processExpiredRounds(new Date(spinning.girandoEndsAt.getTime() + 10));
  return Round.findOne({
    include: [{ model: Room, as: "room", where: { code, }, }],
    where: { state: "LIQUIDADA" },
    order: [["seq", "DESC"]],
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
    username: "cajero.liq",
    name: "Cajero Liq",
    credentialHash: await hashCredential("1234"),
  });
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

test("AC-01/02: al liquidar se calculan premios y /winners los lista", async () => {
  const code = (await makeRoom()).code;
  await bet(code, { side: "red", amountCentimos: 1000, playerName: "Ana Roja" });
  await bet(code, { side: "blue", amountCentimos: 1000, playerName: "Luis Azul" });
  await bet(code, { side: "red", amountCentimos: 1000, playerName: "Lia Roja" });
  const liquidated = await liquidate(code);
  assert.equal(liquidated.state, "LIQUIDADA");

  const winners = await api(`/rooms/${code}/winners?seq=${liquidated.seq}`, {
    token: adminToken,
  });
  assert.equal(winners.status, 200);
  const result = (await api(`/rooms/${code}/rounds`)).body.rounds
    .find((r) => r.seq === liquidated.seq).result;
  for (const w of winners.body.winners) {
    assert.ok(w.payoutCentimos > 0);
    assert.ok(w.playerName && w.phone);
    // Todas del color ganador:
    const row = await Bet.findByPk(w.betId);
    assert.equal(row.side, result.side);
    assert.equal(w.status, "PENDIENTE");
  }
});

test("AC-03: marcar pagada con nº de operación; re-pagar → 409", async () => {
  const code = (await makeRoom()).code;
  await bet(code, { side: "red", amountCentimos: 1000 });
  await bet(code, { side: "blue", amountCentimos: 1000 });
  const liquidated = await liquidate(code);
  const { winners } = (await api(`/rooms/${code}/winners?seq=${liquidated.seq}`, {
    token: adminToken,
  })).body;
  assert.ok(winners.length >= 1);

  const paid = await api(
    `/rooms/${code}/bets/${winners[0].betId}/pay`,
    { method: "POST", body: { operationNumber: "pay-1" }, token: adminToken },
  );
  assert.equal(paid.status, 200);
  assert.equal(paid.body.bet.paidOperationNumber, "pay-1");

  const again = await api(
    `/rooms/${code}/bets/${winners[0].betId}/pay`,
    { method: "POST", body: { operationNumber: "pay-2" }, token: adminToken },
  );
  assert.equal(again.status, 409);
});

test("AC-04: la apuesta arrastrada no genera premio en la ronda anterior", async () => {
  const code = (await makeRoom()).code;
  await bet(code, { side: "red", amountCentimos: 1000 });
  await bet(code, { side: "blue", amountCentimos: 1000 });
  // tercera roja queda en espera (insegura) → arrastra sin premio
  const q = await bet(code, { side: "red", amountCentimos: 1000 });
  const liquidated = await liquidate(code);

  const qRow = await Bet.findByPk(q.body.bets[0].id);
  assert.equal(qRow.payoutCentimos, null); // arrastrada, no liquidada aquí
  const winners = (await api(`/rooms/${code}/winners?seq=${liquidated.seq}`, {
    token: adminToken,
  })).body.winners;
  assert.ok(!winners.some((w) => w.betId === q.body.bets[0].id));
});

test("AC-05: contabilidad por ronda — lo recibido queda trazado (R26)", async () => {
  const code = (await makeRoom()).code;
  await bet(code, { side: "red", amountCentimos: 1000 });
  await bet(code, { side: "blue", amountCentimos: 1000 });
  const extra = await bet(code, { side: "red", amountCentimos: 500 });
  // devolver la en espera
  await api(`/rooms/${code}/bets/${extra.body.bets[0].id}/refund`, {
    method: "POST",
    body: { refundOperationNumber: "dev-x" },
    token: adminToken,
  });
  const liquidated = await liquidate(code);

  const acc = await api(
    `/rooms/${code}/rounds/${liquidated.seq}/accounting`,
    { token: adminToken },
  );
  assert.equal(acc.status, 200);
  const a = acc.body;
  assert.equal(a.pooled, 2000);       // entraron a la bolsa
  assert.equal(a.refunded, 500);      // devuelta antes de entrar
  assert.equal(a.carried, 0);         // nada quedó en espera al cerrar
  assert.equal(a.received, a.pooled + a.carried + a.refunded);
  assert.equal(a.paidOut + a.kept, a.pooled); // la bolsa se reparte entera
});
