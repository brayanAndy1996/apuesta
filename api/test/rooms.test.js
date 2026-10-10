import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { createApp } from "../src/app.js";
import { ensureAdmin, ensureGeneralRoom } from "../src/bootstrap.js";
import { sequelize } from "../src/db.js";
import { hashCredential } from "../src/lib/crypto.js";
import { DEFAULT_SLOTS, Room, RoomSlot } from "../src/models/room.js";
import { ROLES, User } from "../src/models/user.js";

let server;
let base;
let adminToken;

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

async function createCashier(name, pin = "1234") {
  return User.create({
    role: ROLES.CASHIER,
    username: name.toLowerCase().replace(/[^a-z0-9]+/g, "."),
    name,
    credentialHash: await hashCredential(pin),
  });
}

before(async () => {
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "admin1234";
  await RoomSlot.destroy({ where: {} });
  await Room.destroy({ where: {} });
  await User.destroy({ where: {} });
  await ensureAdmin();
  await ensureGeneralRoom();
  server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await api("/auth/login", {
    method: "POST",
    body: { username: "admin", password: "admin1234" },
  });
  adminToken = login.body.token;
});

after(async () => {
  server?.close();
  await RoomSlot.destroy({ where: {} });
  await Room.destroy({ where: {} });
  await User.destroy({ where: {} });
  await sequelize.close();
});

test("la sala general existe y es pública", async () => {
  const list = await api("/rooms");
  assert.equal(list.status, 200);
  const general = list.body.rooms.find((r) => r.code === "GENERAL");
  assert.ok(general);
  assert.equal(general.name, "Sala general");

  const detail = await api("/rooms/GENERAL");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.slots.length, DEFAULT_SLOTS.length);
});

test("crear sala genera código único de 4 caracteres", async () => {
  const created = await api("/admin/rooms", {
    method: "POST",
    body: { name: "Sala Norte" },
    token: adminToken,
  });
  assert.equal(created.status, 201);
  assert.match(created.body.room.code, /^[A-Z2-9]{4}$/);
  assert.equal(created.body.room.slots.length, DEFAULT_SLOTS.length);

  const publicView = await api(`/rooms/${created.body.room.code}`);
  assert.equal(publicView.status, 200);
  assert.equal(publicView.body.room.name, "Sala Norte");
});

test("casillas inválidas: suma de pesos, multiplicador y color faltante", async () => {
  const badSum = await api("/admin/rooms", {
    method: "POST",
    body: {
      name: "Mala",
      slots: [
        { side: "red", multiplier: 150, weight: 50 },
        { side: "blue", multiplier: 150, weight: 40 },
      ],
    },
    token: adminToken,
  });
  assert.equal(badSum.status, 400);

  const badMult = await api("/admin/rooms", {
    method: "POST",
    body: {
      name: "Mala",
      slots: [
        { side: "red", multiplier: 200, weight: 50 },
        { side: "blue", multiplier: 150, weight: 50 },
      ],
    },
    token: adminToken,
  });
  assert.equal(badMult.status, 400);

  const oneSide = await api("/admin/rooms", {
    method: "POST",
    body: {
      name: "Mala",
      slots: [{ side: "red", multiplier: 150, weight: 100 }],
    },
    token: adminToken,
  });
  assert.equal(oneSide.status, 400);
});

test("PUT slots reemplaza todas las casillas", async () => {
  const created = await api("/admin/rooms", {
    method: "POST",
    body: { name: "Cambiable" },
    token: adminToken,
  });
  const id = created.body.room.id;

  const replaced = await api(`/admin/rooms/${id}/slots`, {
    method: "PUT",
    body: {
      slots: [
        { side: "red", multiplier: 120, weight: 50 },
        { side: "blue", multiplier: 130, weight: 50 },
      ],
    },
    token: adminToken,
  });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.slots.length, 2);

  const detail = await api(`/admin/rooms/${id}`, { token: adminToken });
  assert.deepEqual(
    detail.body.room.slots.map((s) => s.multiplier).sort(),
    [120, 130],
  );
});

test("asignación de cajero: rol, existencia y una sola sala", async () => {
  const admin = await User.findOne({ where: { role: "admin" } });
  const cashier = await createCashier("Pedro Sala");

  const withAdmin = await api("/admin/rooms", {
    method: "POST",
    body: { name: "X", cashierId: admin.id },
    token: adminToken,
  });
  assert.equal(withAdmin.status, 400);

  const ghost = await api("/admin/rooms", {
    method: "POST",
    body: { name: "X", cashierId: "00000000-0000-0000-0000-000000000000" },
    token: adminToken,
  });
  assert.equal(ghost.status, 400);

  const first = await api("/admin/rooms", {
    method: "POST",
    body: { name: "Sala Uno", cashierId: cashier.id },
    token: adminToken,
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.room.cashier.id, cashier.id);

  const second = await api("/admin/rooms", {
    method: "POST",
    body: { name: "Sala Dos", cashierId: cashier.id },
    token: adminToken,
  });
  assert.equal(second.status, 409);
});

test("reasignar cajero por PATCH y desactivar sala", async () => {
  const cashierA = await createCashier("Ana B", "1111");
  const cashierB = await createCashier("Beto C", "2222");

  const created = await api("/admin/rooms", {
    method: "POST",
    body: { name: "Reasignar", cashierId: cashierA.id },
    token: adminToken,
  });
  const id = created.body.room.id;

  const swapped = await api(`/admin/rooms/${id}`, {
    method: "PATCH",
    body: { cashierId: cashierB.id },
    token: adminToken,
  });
  assert.equal(swapped.status, 200);
  assert.equal(swapped.body.room.cashier.id, cashierB.id);

  const off = await api(`/admin/rooms/${id}`, {
    method: "PATCH",
    body: { active: false },
    token: adminToken,
  });
  assert.equal(off.status, 200);

  const publicView = await api(`/rooms/${created.body.room.code}`);
  assert.equal(publicView.status, 404);

  const adminList = await api("/admin/rooms", { token: adminToken });
  assert.ok(adminList.body.rooms.find((r) => r.id === id));
});

test("la sala general no se puede desactivar", async () => {
  const general = await Room.findOne({ where: { code: "GENERAL" } });
  const res = await api(`/admin/rooms/${general.id}`, {
    method: "PATCH",
    body: { active: false },
    token: adminToken,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.room.active, true);
});

test("solo admin gestiona salas", async () => {
  const cashier = await createCashier("Sin Poder", "3333");
  const login = await api("/auth/pin", {
    method: "POST",
    body: { username: cashier.username, pin: "3333" },
  });
  const res = await api("/admin/rooms", {
    method: "POST",
    body: { name: "Prohibida" },
    token: login.body.token,
  });
  assert.equal(res.status, 403);
});
