import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { isSecure } from "../src/domain/pool.js";
import { settle } from "../src/domain/settlement.js";

const SLOT = { id: "s1", side: "red", multiplier: 170, weight: 50 };

const round = (poolRed, poolBlue) => ({
  poolRedCentimos: poolRed,
  poolBlueCentimos: poolBlue,
  resultSlotId: "s1",
});

const bet = (id, side, amount, status = "POOL") => ({
  id,
  side,
  amountCentimos: amount,
  status,
});

test("AC-01/dom: cada ganadora cobra floor(monto × mult / 100), perdedoras 0", () => {
  const { payouts } = settle(
    round(3000, 2000),
    [SLOT],
    [bet("a", "red", 1000), bet("b", "red", 2000), bet("c", "blue", 500)],
  );
  assert.equal(payouts.length, 2);
  assert.equal(payouts.find((p) => p.betId === "a").amount, 1700);
  assert.equal(payouts.find((p) => p.betId === "b").amount, 3400);
});

test("AC-05/dom: conservación — premios + retenido = bolsa total", () => {
  const r = round(3000, 2000);
  const { payouts, kept } = settle(r, [SLOT], [bet("a", "red", 1000), bet("b", "red", 2000)]);
  assert.equal(payouts.reduce((a, p) => a + p.amount, 0) + kept, 5000);
});

test("AC-04/dom: las QUEUED no cobran premio", () => {
  const { payouts } = settle(round(1000, 0), [SLOT], [
    bet("a", "red", 1000, "QUEUED"),
    bet("b", "red", 1000),
  ]);
  assert.deepEqual(payouts.map((p) => p.betId), ["b"]);
});

test("AC-06/dom (propiedad): con bolsa segura la casa nunca queda negativa", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 101, max: 199 }), // multiplicador 1.01–1.99
      fc.integer({ min: 0, max: 10_000 }),
      fc.integer({ min: 0, max: 10_000 }),
      (multiplier, poolRed, poolBlue) => {
        fc.pre(isSecure(poolRed, poolBlue, 199)); // premisa R10/R26
        const slot = { id: "s", side: "red", multiplier, weight: 50 };
        const { payouts, kept } = settle(
          { poolRedCentimos: poolRed, poolBlueCentimos: poolBlue, resultSlotId: "s" },
          [slot],
          [bet("w", "red", poolRed)],
        );
        const total = poolRed + poolBlue;
        assert.ok(payouts.reduce((a, p) => a + p.amount, 0) <= total);
        assert.equal(kept, total - payouts.reduce((a, p) => a + p.amount, 0));
      },
    ),
  );
});
