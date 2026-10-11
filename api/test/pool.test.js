import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import {
  admit,
  createPool,
  drain,
  equalize,
  isSecure,
  maxMultiplier,
  missingFor,
  otherSide,
  payout,
  totals,
  validateBet,
} from "../src/domain/pool.js";

const MULT = 190;
const MIN = 1000;

const replay = (bets, opts = {}) => {
  const state = createPool({ multMax: opts.multMax ?? MULT, minTotal: opts.minTotal ?? MIN });
  for (const b of bets) admit(state, b.side, b.amount);
  return state;
};

const arbBet = fc.record({
  side: fc.constantFrom("red", "blue"),
  amount: fc.integer({ min: 100, max: 5000 }),
});

const sum = (list) => list.reduce((a, b) => a + b.amount, 0);

test("R12 literal: pools 3000/2000 bloqueados; +10 rojo espera; +20 azul → 40/40", () => {
  // El doc da las bolsas 30/20 como estado inicial: se inyecta directamente.
  const state = createPool({ multMax: MULT });
  state.pools.red = 3000;
  state.pools.blue = 2000;

  // +10 rojo (S/ 10): queda en espera (4000×1.9 > 6000)
  admit(state, "red", 1000);
  assert.deepEqual(totals(state).pool, { red: 3000, blue: 2000 });
  assert.equal(totals(state).queued.red, 1000);

  // +20 azul: entran ambos → 40/40
  admit(state, "blue", 2000);
  assert.deepEqual(totals(state).pool, { red: 4000, blue: 4000 });
  assert.equal(isSecure(4000, 4000, MULT), true);
});

test("flujo real: sobre-admisión deja al otro color varado hasta igualar", () => {
  // 2000/2000 seguro → +1000 rojo se bloquea → llegan 400+300 azules: el rojo
  // entra cubierto por la cola azul completa (3000 vs 2700 justo) y los azules
  // quedan varados (el frente de 400 solo no cubre: 5700 > 5400).
  const state = replay([
    { side: "red", amount: 2000 },
    { side: "blue", amount: 2000 },
    { side: "red", amount: 1000 },
    { side: "blue", amount: 400 },
    { side: "blue", amount: 300 },
  ]);
  assert.deepEqual(totals(state).pool, { red: 3000, blue: 2000 });
  assert.deepEqual(totals(state).queued, { red: 0, blue: 700 });
  assert.equal(isSecure(3000, 2000, MULT), false);
});

test("payout: redondeo hacia abajo al céntimo (R2)", () => {
  assert.equal(payout(1000, 190), 1900);
  assert.equal(payout(333, 170), 566); // 566.1 → 566
  assert.equal(payout(101, 199), 200); // 200.99 → 200
  assert.equal(payout(99, 150), 148);
});

test("isSecure: exige total ≥ S/ 10 y cobertura del multiplicador máximo", () => {
  assert.equal(isSecure(500, 500, MULT), true); // 950 ≤ 1000
  assert.equal(isSecure(500, 400, MULT), false); // total < 1000
  assert.equal(isSecure(900, 200, MULT), false); // 1710 > 1100
  assert.equal(isSecure(0, 2000, MULT), false); // 3800 > 2000
  assert.equal(isSecure(0, 0, MULT), false);
});

test("validateBet: entero dentro del rango", () => {
  assert.equal(validateBet(100, 100, 5000), null);
  assert.equal(validateBet(99, 100, 5000), "monto por debajo del mínimo");
  assert.equal(validateBet(5001, 100, 5000), "monto por encima del máximo");
  assert.equal(validateBet(10.5, 100, 5000), "el monto debe ser en céntimos enteros");
});

test("maxMultiplier", () => {
  assert.equal(maxMultiplier([{ multiplier: 150 }, { multiplier: 190 }]), 190);
});

test("equalize: la cola ligera cubre el déficit y gira de inmediato", () => {
  const state = createPool({ multMax: MULT });
  state.pools.red = 3000;
  state.queues.blue.push({ seq: 1, side: "blue", amount: 3000 });
  state.seq = 1;

  const { spun } = equalize(state);
  assert.equal(spun, true);
  assert.deepEqual(totals(state).pool, { red: 3000, blue: 3000 });
  assert.deepEqual(totals(state).queued, { red: 0, blue: 0 });
});

test("equalize: apuesta partida — el excedente queda al frente de la cola", () => {
  // Estado real vía flujo: rojo 3000 entra cubierto por 3200 azules en espera
  // y el frente azul (2000) queda varado junto con su cola.
  const state = replay([
    { side: "blue", amount: 2000 },
    { side: "blue", amount: 1200 },
    { side: "red", amount: 3000 },
  ]);
  assert.deepEqual(totals(state).pool, { red: 3000, blue: 0 });
  assert.deepEqual(totals(state).queued, { red: 0, blue: 3200 });

  const { spun } = equalize(state);
  assert.equal(spun, true);
  assert.deepEqual(totals(state).pool, { red: 3000, blue: 3000 });
  // entraron 2000 + 1000; del segundo quedan 200 al frente para la próxima
  assert.equal(totals(state).queued.blue, 200);
  assert.equal(state.queues.blue[0].amount, 200);
});

test("equalize: sin demanda en ambos colores no gira", () => {
  const state = createPool({ multMax: MULT });
  admit(state, "red", 3000);
  const { spun } = equalize(state);
  assert.equal(spun, false);
});

test("equalize: cola bloqueada en ambos colores — saca simétrico de las colas", () => {
  // Deadlock: ningún frente puede entrar solo (2500 rojo + 1500 azul con
  // bolsas en 0). La igualación debe subir ambas bolsas por igual.
  const state = replay([
    { side: "red", amount: 2500 },
    { side: "blue", amount: 1500 },
  ]);
  assert.deepEqual(totals(state).pool, { red: 0, blue: 0 });

  const { spun } = equalize(state);
  assert.equal(spun, true);
  assert.deepEqual(totals(state).pool, { red: 1500, blue: 1500 });
  assert.equal(totals(state).queued.red, 1000);
  assert.equal(state.queues.red[0].amount, 1000); // el frente rojo se partió
});

test("equalize: deadlock sin material para bolsa segura no gira", () => {
  const state = replay([
    { side: "red", amount: 300 },
    { side: "blue", amount: 300 },
  ]);
  const { spun } = equalize(state);
  assert.equal(spun, false); // 300/300 < minTotal
  assert.deepEqual(totals(state).queued, { red: 300, blue: 300 });
});

test("equalize: igualar por debajo del mínimo no gira ni mueve dinero", () => {
  const state = createPool({ multMax: MULT });
  state.pools.red = 300;
  state.queues.blue.push({ seq: 1, side: "blue", amount: 300 });
  state.seq = 1;
  const { spun } = equalize(state);
  assert.equal(spun, false);
  assert.equal(totals(state).pool.blue, 0);
  assert.equal(totals(state).queued.blue, 300);
});

test("equalize: una bolsa ya supera la demanda del otro color — no gira", () => {
  const state = createPool({ multMax: MULT });
  state.pools.red = 3000;
  state.queues.blue.push({ seq: 1, side: "blue", amount: 1000 });
  state.seq = 1;
  const { spun } = equalize(state);
  assert.equal(spun, false); // no hay azules suficientes para igualar 3000
});

test("missingFor: reporta el rango del otro color que desbloquea el frente", () => {
  const state = createPool({ multMax: MULT });
  state.pools.red = 3000;
  state.pools.blue = 2000;
  state.queues.red.push({ seq: 1, side: "red", amount: 1000 });
  state.seq = 1;
  const missing = missingFor(state, "red");
  // falta azul para que isSecure(4000, 2000 + c): 4000×1.9=7600 ≤ 4000+2000+c → c ≥ 1600
  // y (2000+c) ≤ 4000 → sin tope superior relevante hasta 4000·100/90 ≈ 4444 → max 2444
  assert.equal(missing.min, 1600);
  assert.ok(missing.max >= missing.min);
  assert.equal(missingFor(state, "blue"), null); // cola azul vacía
});

// ---------- Propiedades (R26) ----------

test("propiedad: conservación — recibido = bolsa + espera (nunca se pierde un céntimo)", () => {
  fc.assert(
    fc.property(fc.array(arbBet, { maxLength: 60 }), (bets) => {
      const state = replay(bets);
      const received = sum(bets);
      const t = totals(state);
      const held = t.pool.red + t.pool.blue + t.queued.red + t.queued.blue;
      assert.equal(held, received);
    }),
  );
});

test("propiedad: la casa nunca queda negativa si la ronda es segura", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100000 }),
      fc.integer({ min: 0, max: 100000 }),
      fc.integer({ min: 101, max: 199 }),
      (red, blue, mult) => {
        if (isSecure(red, blue, mult)) {
          const worst = payout(Math.max(red, blue), mult);
          assert.ok(worst <= red + blue, `${red}/${blue} mult ${mult} → pago ${worst}`);
        }
      },
    ),
  );
});

test("propiedad: drain es terminal — ningún frente de cola puede entrar después", () => {
  fc.assert(
    fc.property(fc.array(arbBet, { maxLength: 60 }), (bets) => {
      const state = replay(bets);
      drain(state); // idempotente
      for (const side of ["red", "blue"]) {
        const front = state.queues[side][0];
        if (!front) continue;
        const other = otherSide(side);
        const poolS = state.pools[side] + front.amount;
        const poolO = state.pools[other] + sum(state.queues[other]);
        const red = side === "red" ? poolS : poolO;
        const blue = side === "blue" ? poolS : poolO;
        assert.equal(
          isSecure(red, blue, state.multMax, state.minTotal),
          false,
          `frente ${side} aún admisible tras drain`,
        );
      }
    }),
  );
});

test("propiedad: FIFO por color — las que entran respetan el orden de llegada", () => {
  fc.assert(
    fc.property(fc.array(arbBet, { maxLength: 60 }), (bets) => {
      const state = replay(bets);
      for (const side of ["red", "blue"]) {
        const seqs = state.queues[side].map((b) => b.seq);
        const sorted = [...seqs].sort((a, b) => a - b);
        assert.deepEqual(seqs, sorted);
      }
    }),
  );
});

test("propiedad: payout es monótono y nunca excede monto × mult/100", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100000 }),
      fc.integer({ min: 101, max: 199 }),
      (amount, mult) => {
        const p = payout(amount, mult);
        assert.ok(p <= (amount * mult) / 100 + 1e-9);
        assert.ok(p > (amount * mult) / 100 - 1);
        assert.ok(payout(amount + 1, mult) >= p);
      },
    ),
  );
});

test("propiedad: equalize con spun=true deja bolsas iguales y conserva el dinero", () => {
  fc.assert(
    fc.property(fc.array(arbBet, { maxLength: 60 }), (bets) => {
      const state = replay(bets);
      const before = totals(state);
      const heldBefore =
        before.pool.red + before.pool.blue + before.queued.red + before.queued.blue;
      const { spun } = equalize(state);
      const after = totals(state);
      const heldAfter =
        after.pool.red + after.pool.blue + after.queued.red + after.queued.blue;
      assert.equal(heldAfter, heldBefore);
      if (spun) assert.equal(after.pool.red, after.pool.blue);
    }),
  );
});
