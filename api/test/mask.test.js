import assert from "node:assert/strict";
import test from "node:test";

import { maskPhone, publicName, winRangeCentimos } from "../src/lib/mask.js";

const slotsOf = (side, ...multipliers) =>
  multipliers.map((multiplier, i) => ({ side, multiplier, weight: 1, id: i }));

test("AC-01: publicName toma primer nombre + inicial del apellido", () => {
  assert.equal(publicName("Juan Pérez"), "Juan P.");
  assert.equal(publicName("María José Quispe"), "María Q.");
  assert.equal(publicName("María"), "María");
  assert.equal(publicName(null), null);
  assert.equal(publicName(""), null);
});

test("AC-02: maskPhone solo deja los últimos 3 dígitos", () => {
  assert.equal(maskPhone("999888777"), "*** *** 777");
  assert.equal(maskPhone("51 999 888 777"), "*** *** 777");
  assert.equal(maskPhone("777"), "*** *** 777");
  assert.equal(maskPhone(null), null);
  assert.equal(maskPhone("12"), "*** *** 12");
});

test("AC-04: winRangeCentimos = monto × mín/máx multiplicador del color", () => {
  const slots = [...slotsOf("red", 150, 190, 170), ...slotsOf("blue", 160, 180)];
  assert.deepEqual(winRangeCentimos(1000, slots, "red"), { min: 1500, max: 1900 });
  assert.deepEqual(winRangeCentimos(1000, slots, "blue"), { min: 1600, max: 1800 });
  assert.equal(winRangeCentimos(1000, slots, null), null);
  // redondeo hacia abajo (R2)
  assert.deepEqual(winRangeCentimos(333, slots, "red"), { min: 499, max: 632 });
});
