// Dominio puro de la bolsa (R1–R3, R10–R12, R16, R26).
// Sin Sequelize, sin Express, sin reloj, sin aleatoriedad.
// Dinero en céntimos enteros; multiplicadores en centésimas (1.70 = 170).

export const SIDES = Object.freeze({ RED: "red", BLUE: "blue" });

export const otherSide = (side) => (side === SIDES.RED ? SIDES.BLUE : SIDES.RED);

// R2: pago redondeado hacia abajo al céntimo.
export const payout = (amountCentimos, multiplier) =>
  Math.floor((amountCentimos * multiplier) / 100);

export const maxMultiplier = (slots) =>
  Math.max(...slots.map((s) => s.multiplier));

// R3: la apuesta admite céntimos; el tope es por apuesta.
export function validateBet(amountCentimos, minBetCentimos, maxBetCentimos) {
  if (!Number.isInteger(amountCentimos)) return "el monto debe ser en céntimos enteros";
  if (amountCentimos < minBetCentimos) return "monto por debajo del mínimo";
  if (amountCentimos > maxBetCentimos) return "monto por encima del máximo";
  return null;
}

// R10: segura ⇔ total ≥ minTotal y ningún color × mult_max supera el total.
export function isSecure(redPool, bluePool, multMax, minTotal = 1000) {
  const total = redPool + bluePool;
  return total >= minTotal && Math.max(redPool, bluePool) * multMax <= total * 100;
}

// Estado de la bolsa: pools = lo que entró, queues = lo que espera (FIFO por color).
export function createPool({ multMax, minTotal = 1000 } = {}) {
  if (!Number.isInteger(multMax) || multMax < 101 || multMax > 199) {
    throw new Error("multMax debe ser un entero entre 101 y 199");
  }
  return {
    multMax,
    minTotal,
    seq: 0,
    pools: { [SIDES.RED]: 0, [SIDES.BLUE]: 0 },
    queues: { [SIDES.RED]: [], [SIDES.BLUE]: [] },
  };
}

const queueSum = (queue) => queue.reduce((acc, b) => acc + b.amount, 0);

export const totals = (state) => ({
  pool: { ...state.pools },
  queued: { [SIDES.RED]: queueSum(state.queues[SIDES.RED]), [SIDES.BLUE]: queueSum(state.queues[SIDES.BLUE]) },
});

// R11 literal: entra si, junto con TODAS las que esperan del otro color, queda segura.
function canAdmit(state, bet) {
  const other = otherSide(bet.side);
  const poolS = state.pools[bet.side] + bet.amount;
  const poolO = state.pools[other] + queueSum(state.queues[other]);
  const red = bet.side === SIDES.RED ? poolS : poolO;
  const blue = bet.side === SIDES.BLUE ? poolS : poolO;
  return isSecure(red, blue, state.multMax, state.minTotal);
}

// Registra la apuesta al final de la cola de su color y drena lo que se pueda.
export function admit(state, side, amountCentimos) {
  const bet = { seq: ++state.seq, side, amount: amountCentimos };
  state.queues[side].push(bet);
  drain(state);
  return bet;
}

// Drena la cola: evalúa primero la apuesta más antigua en espera; si no puede
// entrar, intenta la del otro color. Repite hasta que ningún frente pueda entrar.
export function drain(state) {
  for (;;) {
    const frontRed = state.queues[SIDES.RED][0];
    const frontBlue = state.queues[SIDES.BLUE][0];
    if (!frontRed && !frontBlue) return state;
    const order =
      frontRed && (!frontBlue || frontRed.seq < frontBlue.seq)
        ? [frontRed, frontBlue]
        : [frontBlue, frontRed];
    let moved = false;
    for (const bet of order) {
      if (bet && canAdmit(state, bet)) {
        state.queues[bet.side].shift();
        state.pools[bet.side] += bet.amount;
        moved = true;
      }
    }
    if (!moved) return state;
  }
}

// R13: cuánto falta del otro color para que entre el frente de la cola de `side`.
// null si la cola está vacía. Con mult < 200 el rango viable tiene cota
// inferior y superior: devuelve { min, max } en céntimos extra necesarios
// sobre el pool del otro color (max = null si no hay tope).
export function missingFor(state, side) {
  const front = state.queues[side][0];
  if (!front) return null;
  const other = otherSide(side);
  const a = state.pools[side] + front.amount; // exposición propia si entra
  const c0 = state.pools[other]; // base del otro color

  // Restricciones sobre C = poolO + extra:
  //   a + C ≥ minTotal            → C ≥ minTotal − a
  //   si a ≥ C: a·m ≤ (a+C)·100   → C ≥ a·(m−100)/100
  //   si C > a: C·m ≤ (a+C)·100   → C ≤ a·100/(m−100)
  const lower = Math.max(c0, state.minTotal - a, Math.ceil((a * (state.multMax - 100)) / 100));
  const upper = Math.floor((a * 100) / (state.multMax - 100));
  if (lower > upper) return { min: null, max: null };
  return {
    min: Math.max(0, lower - c0),
    max: Math.max(0, upper - c0),
  };
}

// R16: igualación al cumplirse el tiempo máximo.
// Solo si hay demanda en ambos colores y la bolsa no es segura: de la cola del
// color que falta entra exactamente lo necesario para igualar, en orden; una
// apuesta puede entrar en parte y el resto queda al inicio de su cola.
// spun=true cuando quedó igualada y puede girar de inmediato.
export function equalize(state) {
  const { pools, queues, multMax, minTotal } = state;
  if (isSecure(pools[SIDES.RED], pools[SIDES.BLUE], multMax, minTotal)) {
    return { state, spun: false };
  }
  const demandRed = pools[SIDES.RED] + queueSum(queues[SIDES.RED]);
  const demandBlue = pools[SIDES.BLUE] + queueSum(queues[SIDES.BLUE]);
  if (demandRed === 0 || demandBlue === 0) return { state, spun: false };

  const [heavy, light] =
    pools[SIDES.RED] >= pools[SIDES.BLUE] ? [SIDES.RED, SIDES.BLUE] : [SIDES.BLUE, SIDES.RED];
  const deficit = pools[heavy] - pools[light];
  if (deficit === 0) return { state, spun: false };
  if (queueSum(queues[light]) < deficit) return { state, spun: false };

  let remaining = deficit;
  while (remaining > 0) {
    const front = queues[light][0];
    const take = Math.min(front.amount, remaining);
    front.amount -= take;
    pools[light] += take;
    remaining -= take;
    if (front.amount === 0) queues[light].shift();
  }
  return { state, spun: true };
}
