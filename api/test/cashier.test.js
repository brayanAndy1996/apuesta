import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";

import { createApp } from "../src/app.js";
import { hashCredential } from "../src/lib/crypto.js";
import { parseBetMessage } from "../src/lib/betMessage.js";
import { ROLES } from "../src/models/user.js";
import { Bet, Round } from "../src/models/round.js";
import { ensureAdmin, ensureGeneralRoom } from "../src/bootstrap.js";
import { Room, RoomSlot } from "../src/models/room.js";
import { User } from "../src/models/user.js";
import { processExpiredRounds } from "../src/services/roundService.js";
import { sequelize } from "../src/db.js";

let server;
let base;
let adminToken;
let cashierToken;
let cashier;
let room;
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

async function makeRoom(extra = {}) {
  const created = await api("/admin/rooms", {
    method: "POST",
    body: { name: `Sala C${++roomSeq}`, ...extra },
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
    username: "cajero.007",
    name: "Cajero Siete",
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
      body: { username: "cajero.007", pin: "1234" },
    })
  ).body.token;

  room = await makeRoom({ cashierId: cashier.id });
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

test("AC-01: registro completo guarda datos de pago y entra a la cola", async () => {
  const res = await bet(room.code, { operationNumber: "yape-001" });
  assert.equal(res.status, 201);
  const [created] = res.body.bets;
  assert.equal(created.playerName, "Jugador Test");
  assert.equal(created.method, "yape");
  assert.equal(created.operationNumber, "yape-001");
  assert.equal(created.paymentVerified, true);
  assert.ok(["QUEUED", "POOL"].includes(created.status));

  const tray = await api(`/rooms/${room.code}/bets`, { token: cashierToken });
  assert.equal(tray.status, 200);
  assert.ok(tray.body.bets.some((b) => b.operationNumber === "yape-001"));
});

test("AC-02: el número de operación es único por método (R20)", async () => {
  const code = (await makeRoom()).code;
  const first = await bet(code, { operationNumber: "dup-1", method: "yape" });
  assert.equal(first.status, 201);
  const dup = await bet(code, { operationNumber: "dup-1", method: "yape" });
  assert.equal(dup.status, 409);
  const otherMethod = await bet(code, {
    operationNumber: "dup-1",
    method: "plin",
  });
  assert.equal(otherMethod.status, 201);
});

test("AC-03: sin \"pago verificado\" el registro se rechaza", async () => {
  const res = await bet(room.code, { paymentVerified: false });
  assert.equal(res.status, 400);
});

test("AC-04: el excedente sobre el máximo queda como otra apuesta (R21)", async () => {
  const code = (await makeRoom()).code;
  const res = await bet(code, { side: "red", amountCentimos: 6000 });
  assert.equal(res.status, 201);
  assert.equal(res.body.bets.length, 2);
  assert.equal(res.body.bets[0].amountCentimos, 5000); // máximo de la sala
  assert.equal(res.body.bets[1].amountCentimos, 1000); // excedente en espera
  assert.equal(res.body.bets[1].side, "red");
});

test("AC-05: sin color no entra a la cola hasta aclararlo (R22)", async () => {
  const code = (await makeRoom()).code;
  const res = await bet(code, { side: null, amountCentimos: 700 });
  assert.equal(res.status, 201);
  const [noColor] = res.body.bets;
  assert.equal(noColor.side, null);
  assert.equal(noColor.status, "QUEUED");

  // La bolsa no lo contó.
  const view = (await api(`/rooms/${code}/round`)).body.round;
  assert.equal(view.queued.red, 0);
  assert.equal(view.queued.blue, 0);

  const assigned = await api(`/rooms/${code}/bets/${noColor.id}`, {
    method: "PATCH",
    body: { side: "blue" },
    token: adminToken,
  });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.bet.side, "blue");

  const after = (await api(`/rooms/${code}/round`)).body.round;
  assert.equal(after.queued.blue, 700);
});

test("AC-06: anular descuenta la bolsa y exige motivo; cerrada no se puede (R23)", async () => {
  const code = (await makeRoom()).code;
  await bet(code, { side: "red", amountCentimos: 1000 });
  const b = await bet(code, { side: "blue", amountCentimos: 1000 });
  assert.equal(b.body.bets[0].status, "POOL");

  // Motivo obligatorio.
  const noReason = await api(
    `/rooms/${code}/bets/${b.body.bets[0].id}/annul`,
    { method: "POST", body: {}, token: adminToken },
  );
  assert.equal(noReason.status, 400);

  // Anular la azul: la bolsa queda insegura → PAUSADA.
  const annulled = await api(
    `/rooms/${code}/bets/${b.body.bets[0].id}/annul`,
    { method: "POST", body: { reason: "pago rebotado" }, token: adminToken },
  );
  assert.equal(annulled.status, 200);
  assert.equal(annulled.body.bet.status, "ANULADA");
  assert.equal(annulled.body.bet.annulReason, "pago rebotado");
  assert.equal(annulled.body.round.state, "PAUSADA");

  const view = (await api(`/rooms/${code}/round`)).body.round;
  assert.equal(view.pools.blue, 0);

  // Tras cerrar la ronda ya no se puede anular.
  const code2 = (await makeRoom()).code;
  const c1 = await bet(code2, { side: "red", amountCentimos: 1000 });
  await bet(code2, { side: "blue", amountCentimos: 1000 });
  const endsAt = (await api(`/rooms/${code2}/round`)).body.round.countdownEndsAt;
  await processExpiredRounds(new Date(Date.parse(endsAt) + 10));
  const late = await api(
    `/rooms/${code2}/bets/${c1.body.bets[0].id}/annul`,
    { method: "POST", body: { reason: "tarde" }, token: adminToken },
  );
  assert.equal(late.status, 409);
});

test("AC-07: solo se devuelve lo que está en espera, con nº de devolución (R24)", async () => {
  const code = (await makeRoom()).code;
  const pooled = await bet(code, { side: "red", amountCentimos: 1000 });
  const pooled2 = await bet(code, { side: "blue", amountCentimos: 1000 });
  assert.equal(pooled2.body.bets[0].status, "POOL");

  const noRefund = await api(
    `/rooms/${code}/bets/${pooled.body.bets[0].id}/refund`,
    {
      method: "POST",
      body: { refundOperationNumber: "dev-1" },
      token: adminToken,
    },
  );
  assert.equal(noRefund.status, 409); // estaba en la bolsa

  const queued = await bet(code, { side: "red", amountCentimos: 1000 });
  // red desbordada: esta tercera roja queda en espera.
  const refunded = await api(
    `/rooms/${code}/bets/${queued.body.bets[0].id}/refund`,
    {
      method: "POST",
      body: { refundOperationNumber: "dev-1" },
      token: adminToken,
    },
  );
  assert.equal(refunded.status, 200);
  assert.equal(refunded.body.bet.status, "DEVUELTA");
  assert.equal(refunded.body.bet.refundOperationNumber, "dev-1");
});

test("AC-08: pegar el mensaje autocompleta los campos (R18/R19)", async () => {
  const parsed = parseBetMessage(
    "APUESTA · Sala GENERAL · ROJO · S/ 10.00 · Juan Pérez · 987654321",
  );
  assert.equal(parsed.side, "red");
  assert.equal(parsed.amountCentimos, 1000);
  assert.equal(parsed.playerName, "Juan Pérez");
  assert.equal(parsed.phone, "987654321");

  // Texto libre: extrae lo que puede sin romper.
  const partial = parseBetMessage("yapé 15 soles al azul 999888777");
  assert.equal(partial.side, "blue");
  assert.equal(partial.phone, "999888777");

  const empty = parseBetMessage("mensaje sin datos");
  assert.equal(empty.side, undefined);
});

test("AC-extra: la bandeja separa sin color de las demás", async () => {
  const code = (await makeRoom()).code;
  await bet(code, { side: null, amountCentimos: 500 });
  const tray = await api(`/rooms/${code}/bets`, { token: adminToken });
  const sinColor = tray.body.bets.filter((b) => b.side === null);
  assert.equal(sinColor.length, 1);
  assert.equal(tray.body.open, true);
});
