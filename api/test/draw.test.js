import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import fc from "fast-check";

import { drawSlot } from "../src/domain/draw.js";
import { DEFAULT_SLOTS } from "../src/models/room.js";

const hexSeed = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Buffer.from(bytes).toString("hex"));

test("drawSlot es determinista y devuelve una casilla de la sala (AC-01)", () => {
  const seed = "a".repeat(64);
  const first = drawSlot(seed, DEFAULT_SLOTS);
  const second = drawSlot(seed, DEFAULT_SLOTS);
  assert.equal(first.slot.id ?? first.slot.multiplier, second.slot.multiplier);
  assert.equal(first.pos, second.pos);
  assert.ok(DEFAULT_SLOTS.some((s) => s.multiplier === first.slot.multiplier && s.side === first.slot.side));
});

test("drawSlot rechaza semilla inválida y pesos que no suman 100", () => {
  assert.throws(() => drawSlot("zzzz", DEFAULT_SLOTS));
  assert.throws(() =>
    drawSlot("ab".repeat(32), [{ side: "red", multiplier: 150, weight: 99 }]),
  );
});

test("propiedad: cualquier configuración válida elige una casilla en rango (AC-06)", () => {
  const slotsArb = fc
    .array(
      fc.record({
        side: fc.constantFrom("red", "blue"),
        multiplier: fc.integer({ min: 101, max: 199 }),
        weight: fc.constant(1),
        id: fc.uuid(),
      }),
      { minLength: 100, maxLength: 100 },
    ); // 100 casillas de peso 1 → siempre suma 100
  fc.assert(
    fc.property(hexSeed, slotsArb, (seed, slots) => {
      const { slot, pos } = drawSlot(seed, slots);
      assert.ok(slots.includes(slot));
      assert.ok(pos >= 0 && pos < 100);
    }),
  );
});

test("distribución proporcional al peso (AC-02, tolerancia estadística)", () => {
  const runs = 20_000;
  const counts = new Map();
  for (let i = 0; i < runs; i++) {
    const seed = createHash("sha256").update(`seed-${i}`).digest("hex");
    const { slot } = drawSlot(seed, DEFAULT_SLOTS);
    const key = `${slot.side}:${slot.multiplier}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const s of DEFAULT_SLOTS) {
    const freq = (counts.get(`${s.side}:${s.multiplier}`) ?? 0) / runs;
    assert.ok(
      Math.abs(freq - s.weight / 100) < 0.015,
      `${s.side}:${s.multiplier} freq ${freq} vs ${s.weight / 100}`,
    );
  }
});
