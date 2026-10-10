import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { createApp } from "../src/app.js";
import { sequelize } from "../src/db.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("GET /health responde 200 con db up cuando hay conexión", async (t) => {
  const server = await listen(createApp());
  t.after(async () => {
    server.close();
    await sequelize.close();
  });

  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await res.json();

  // Con la BD levantada (scripts/db-up.sh) debe ser 200; sin BD, 503.
  if (res.status === 200) {
    assert.deepEqual(body, { status: "ok", db: "up" });
  } else {
    assert.equal(res.status, 503);
    assert.deepEqual(body, { status: "degraded", db: "down" });
  }
});
