import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { createApp } from "../src/app.js";
import { ensureAdmin } from "../src/bootstrap.js";
import { sequelize } from "../src/db.js";
import { hashCredential, verifyCredential } from "../src/lib/crypto.js";
import { User } from "../src/models/user.js";

let server;
let base;

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

async function loginAdmin() {
  const res = await api("/auth/login", {
    method: "POST",
    body: { username: "admin", password: "admin1234" },
  });
  assert.equal(res.status, 200);
  return res.body.token;
}

before(async () => {
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "admin1234";
  await User.destroy({ where: {} });
  await ensureAdmin();
  server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await User.destroy({ where: {} });
  await sequelize.close();
});

test("scrypt hash/verify con entradas arbitrarias", async () => {
  for (const plain of ["admin1234", "123456", "🔑 clave rara", "x".repeat(200)]) {
    const stored = await hashCredential(plain);
    assert.equal(await verifyCredential(plain, stored), true);
    assert.equal(await verifyCredential(`${plain}!`, stored), false);
  }
});

test("login de admin correcto e incorrecto", async () => {
  const ok = await api("/auth/login", {
    method: "POST",
    body: { username: "admin", password: "admin1234" },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, "admin");

  const bad = await api("/auth/login", {
    method: "POST",
    body: { username: "admin", password: "mala" },
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, "credenciales inválidas");
});

test("un cajero no puede entrar por /auth/login ni un admin por /auth/pin", async () => {
  const token = await loginAdmin();
  const created = await api("/admin/cashiers", {
    method: "POST",
    body: { name: "Rosa Quispe", pin: "4321" },
    token,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.username, "rosa.quispe");

  const asAdmin = await api("/auth/login", {
    method: "POST",
    body: { username: "rosa.quispe", password: "4321" },
  });
  assert.equal(asAdmin.status, 401);

  const asCashier = await api("/auth/pin", {
    method: "POST",
    body: { username: "admin", pin: "1234" },
  });
  assert.equal(asCashier.status, 401);
});

test("login de cajero con PIN: éxito, PIN malo y PIN no numérico", async () => {
  const token = await loginAdmin();
  await api("/admin/cashiers", {
    method: "POST",
    body: { name: "Juan Perez", pin: "998877" },
    token,
  });

  const ok = await api("/auth/pin", {
    method: "POST",
    body: { username: "juan.perez", pin: "998877" },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, "cashier");

  const wrongPin = await api("/auth/pin", {
    method: "POST",
    body: { username: "juan.perez", pin: "000000" },
  });
  assert.equal(wrongPin.status, 401);

  const notNumeric = await api("/auth/pin", {
    method: "POST",
    body: { username: "juan.perez", pin: "abcd" },
  });
  assert.equal(notNumeric.status, 400);
});

test("/auth/me y control de roles", async () => {
  const token = await loginAdmin();

  const me = await api("/auth/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, "admin");

  const noToken = await api("/auth/me");
  assert.equal(noToken.status, 401);

  const fake = await api("/auth/me", { token: "firma.falsa" });
  assert.equal(fake.status, 401);

  const cashierToken = (await api("/auth/pin", {
    method: "POST",
    body: { username: "juan.perez", pin: "998877" },
  })).body.token;

  const forbidden = await api("/admin/cashiers", { token: cashierToken });
  assert.equal(forbidden.status, 403);
});

test("cajero desactivado: login rechazado y token previo inválido", async () => {
  const adminToken = await loginAdmin();
  const list = await api("/admin/cashiers", { token: adminToken });
  const juan = list.body.cashiers.find((c) => c.username === "juan.perez");

  const cashierToken = (await api("/auth/pin", {
    method: "POST",
    body: { username: "juan.perez", pin: "998877" },
  })).body.token;
  assert.ok(cashierToken);

  const off = await api(`/admin/cashiers/${juan.id}`, {
    method: "PATCH",
    body: { active: false },
    token: adminToken,
  });
  assert.equal(off.status, 200);

  const relogin = await api("/auth/pin", {
    method: "POST",
    body: { username: "juan.perez", pin: "998877" },
  });
  assert.equal(relogin.status, 401);

  const staleToken = await api("/auth/me", { token: cashierToken });
  assert.equal(staleToken.status, 401);
});

test("crear cajero requiere admin; PIN inválido da 400", async () => {
  const noAuth = await api("/admin/cashiers", {
    method: "POST",
    body: { name: "X", pin: "1234" },
  });
  assert.equal(noAuth.status, 401);

  const token = await loginAdmin();
  const badPin = await api("/admin/cashiers", {
    method: "POST",
    body: { name: "Mala Pin", pin: "12345678" },
    token,
  });
  assert.equal(badPin.status, 400);
});

test("username autogenerado no colisiona", async () => {
  const token = await loginAdmin();
  const first = await api("/admin/cashiers", {
    method: "POST",
    body: { name: "Ana Torres", pin: "1111" },
    token,
  });
  const second = await api("/admin/cashiers", {
    method: "POST",
    body: { name: "Ana Torres", pin: "2222" },
    token,
  });
  assert.equal(first.body.user.username, "ana.torres");
  assert.equal(second.body.user.username, "ana.torres2");
});
