import { Op, QueryTypes } from "sequelize";

import { sequelize } from "../db.js";
import { drawSlot } from "../domain/draw.js";
import { createPool, drain, equalize, isSecure, maxMultiplier, missingFor } from "../domain/pool.js";
import { newSeed, seedHash } from "../lib/seed.js";
import { Room } from "../models/room.js";
import {
  BET_STATUS,
  Bet,
  COUNTDOWN_MS,
  MAX_ROUND_MS,
  OPEN_STATES,
  ROUND_STATES,
  Round,
  SPIN_MS,
} from "../models/round.js";

const { ESPERANDO, CUENTA_REGRESIVA, PAUSADA, CERRADA, GIRANDO, LIQUIDADA } =
  ROUND_STATES;

let io = null;
export const setIo = (server) => {
  io = server;
};

const emit = (roomCode, round, extra = {}) => {
  io?.to(`room:${roomCode}`).emit("round:update", {
    seq: round.seq,
    state: round.state,
    pools: { red: round.poolRedCentimos, blue: round.poolBlueCentimos },
    countdownEndsAt: round.countdownEndsAt,
    maxEndsAt: round.maxEndsAt,
    girandoEndsAt: round.girandoEndsAt,
    seedHash: round.seedHash,
    resultSlotId: round.resultSlotId,
    ...extra,
  });
};

// Reconstruye el estado puro de la bolsa desde las filas persistidas.
// Las apuestas "Sin color" (side NULL) quedan fuera de la cola (R22).
async function loadPoolState(room, round, transaction) {
  const slots = await room.getSlots({ transaction });
  const state = createPool({ multMax: maxMultiplier(slots) });
  state.pools.red = round.poolRedCentimos;
  state.pools.blue = round.poolBlueCentimos;
  const queued = await Bet.findAll({
    where: {
      roundId: round.id,
      status: BET_STATUS.QUEUED,
      side: { [Op.ne]: null },
    },
    order: [["seq", "ASC"]],
    transaction,
  });
  for (const b of queued) {
    state.queues[b.side].push({ id: b.id, seq: b.seq, side: b.side, amount: b.amountCentimos });
    state.seq = Math.max(state.seq, b.seq);
  }
  return state;
}

// Persiste el resultado del dominio: apuestas QUEUED→POOL, splits y bolsas.
async function persistState(round, queuedBefore, state, transaction) {
  const stillQueued = new Set();
  for (const side of ["red", "blue"]) {
    for (const b of state.queues[side]) stillQueued.add(b.id);
  }
  const entered = queuedBefore.filter((b) => !stillQueued.has(b.id));
  for (const bet of entered) {
    await Bet.update(
      { status: BET_STATUS.POOL },
      { where: { id: bet.id }, transaction },
    );
  }
  // apuestas partidas por equalize: el frente quedó con monto reducido
  for (const side of ["red", "blue"]) {
    for (const b of state.queues[side]) {
      const before = queuedBefore.find((q) => q.id === b.id);
      if (before && before.amount !== b.amount) {
        await Bet.update(
          { amountCentimos: b.amount },
          { where: { id: b.id }, transaction },
        );
        await Bet.create(
          {
            roundId: round.id,
            seq: b.seq,
            side: b.side,
            amountCentimos: before.amount - b.amount,
            status: BET_STATUS.POOL,
            parentBetId: b.id,
          },
          { transaction },
        );
      }
    }
  }
  round.poolRedCentimos = state.pools.red;
  round.poolBlueCentimos = state.pools.blue;
}

const queuedBetsOf = (state) => [...state.queues.red, ...state.queues.blue];

const secureNow = (state) =>
  isSecure(state.pools.red, state.pools.blue, state.multMax, state.minTotal);

// R15: ajusta estado/temporizadores tras admitir apuestas a la bolsa.
function refreshTimers(round, state, admittedCount, now) {
  if (admittedCount === 0) return;
  if (round.maxEndsAt === null) {
    round.maxEndsAt = new Date(now.getTime() + MAX_ROUND_MS);
  }
  if (secureNow(state)) {
    const remaining =
      round.state === PAUSADA && round.countdownRemainingMs !== null
        ? round.countdownRemainingMs
        : COUNTDOWN_MS;
    round.countdownEndsAt = new Date(now.getTime() + remaining);
    round.countdownRemainingMs = null;
    round.state = CUENTA_REGRESIVA;
  } else if (round.state === CUENTA_REGRESIVA) {
    round.countdownRemainingMs = Math.max(
      0,
      round.countdownEndsAt.getTime() - now.getTime(),
    );
    round.countdownEndsAt = null;
    round.state = PAUSADA;
  } else if (round.state === ESPERANDO) {
    // La primera admisión dejó la bolsa insegura: no hay cuenta que guardar.
    round.state = PAUSADA;
  }
}

const findOpenRound = (room, transaction) =>
  Round.findOne({
    where: { roomId: room.id, state: [...OPEN_STATES] },
    order: [["seq", "DESC"]],
    lock: transaction.LOCK.UPDATE,
    transaction,
  });

async function lockOpenRound(room, transaction) {
  const round = await findOpenRound(room, transaction);
  if (round) return round;
  const last = await Round.max("seq", {
    where: { roomId: room.id },
    transaction,
  });
  const seed = newSeed();
  return Round.create(
    {
      roomId: room.id,
      seq: (last ?? 0) + 1,
      state: ESPERANDO,
      seed,
      seedHash: seedHash(seed),
    },
    { transaction },
  );
}

const nextGlobalSeq = async (roomId, transaction) => {
  const [seqRow] = await sequelize.query(
    `SELECT MAX(b.seq) AS max_seq FROM bets b
     JOIN rounds r ON r.id = b.round_id
     WHERE r.room_id = :roomId`,
    {
      replacements: { roomId },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  return (seqRow?.max_seq ?? 0) + 1;
};

// Drena la bolsa sobre la ronda bloqueada y persiste (admisiones, timers y
// el reintento de igualación si el máximo ya venció). Devuelve el state.
async function drainRound(room, round, transaction, now) {
  const state = await loadPoolState(room, round, transaction);
  const before = queuedBetsOf(state);
  drain(state);
  const admittedCount = before.length - queuedBetsOf(state).length;
  await persistState(round, before, state, transaction);
  refreshTimers(round, state, admittedCount, now);
  if (round.maxExpired && !secureNow(state)) {
    const snapshot = queuedBetsOf(state).map((b) => ({ ...b }));
    const { spun } = equalize(state);
    if (spun) {
      await persistState(round, snapshot, state, transaction);
      closeAndSpin(round, await room.getSlots({ transaction }), now);
    }
  }
  return state;
}

// Registra una o más apuestas del cajero y drena la bolsa.
// R21: si el pago supera el máximo de la sala, la primera apuesta va por el
// tope y el excedente queda como otra apuesta QUEUED del mismo color.
// Reintenta una vez ante el race de creación de ronda abierta: tras un error
// Postgres aborta la transacción, así que el retry la cubre entera.
export async function placeBet(room, bet, now = new Date()) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await placeBetOnce(room, bet, now);
    } catch (err) {
      if (attempt === 0 && err.name === "SequelizeUniqueConstraintError") continue;
      throw err;
    }
  }
}

async function placeBetOnce(room, bet, now) {
  return sequelize.transaction(async (transaction) => {
    const round = await lockOpenRound(room, transaction);
    let seq = await nextGlobalSeq(room.id, transaction);

    const { side, amountCentimos, ...meta } = bet;
    const created = [];
    if (side === null || side === undefined) {
      // R22: bandeja "Sin color" — no entra a la cola del dominio.
      created.push(
        await Bet.create(
          {
            roundId: round.id,
            seq: seq++,
            side: null,
            amountCentimos,
            status: BET_STATUS.QUEUED,
            ...meta,
          },
          { transaction },
        ),
      );
    } else {
      let remaining = amountCentimos;
      while (remaining > 0) {
        const part = Math.min(remaining, room.maxBetCentimos);
        created.push(
          await Bet.create(
            {
              roundId: round.id,
              seq: seq++,
              side,
              amountCentimos: part,
              status: BET_STATUS.QUEUED,
              ...(created.length === 0 ? meta : { cashierId: meta.cashierId }),
            },
            { transaction },
          ),
        );
        remaining -= part;
      }
    }

    const state = await drainRound(room, round, transaction, now);
    await round.save({ transaction });
    for (const b of created) {
      if (b.side !== null) {
        b.status = queuedBetsOf(state).some((q) => q.id === b.id)
          ? BET_STATUS.QUEUED
          : BET_STATUS.POOL;
      }
    }
    return { round, bets: created };
  }).then((result) => {
    emit(room.code, result.round);
    return result;
  });
}

// R22: asigna color a una apuesta "sin color" y la drena a la cola.
export async function assignBetSide(room, betId, side, now = new Date()) {
  return sequelize.transaction(async (transaction) => {
    const bet = await Bet.findByPk(betId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!bet) return { error: "apuesta no encontrada", status: 404 };
    if (bet.side !== null || bet.status !== BET_STATUS.QUEUED) {
      return { error: "la apuesta ya tiene color", status: 409 };
    }
    const round = await Round.findByPk(bet.roundId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!OPEN_STATES.includes(round.state)) {
      return { error: "la ronda ya está cerrada", status: 409 };
    }
    bet.side = side;
    await bet.save({ transaction });
    const state = await drainRound(room, round, transaction, now);
    await round.save({ transaction });
    bet.status = queuedBetsOf(state).some((q) => q.id === bet.id)
      ? BET_STATUS.QUEUED
      : BET_STATUS.POOL;
    return { round, bet };
  }).then((result) => {
    if (result.round) emit(room.code, result.round);
    return result;
  });
}

// R23: anula una apuesta con motivo, solo mientras su ronda está abierta.
// Si estaba en POOL se descuenta de la bolsa y se reevalúa seguridad:
// quedar insegura pausa la cuenta conservando lo que quedaba.
export async function annulBet(room, betId, reason, now = new Date()) {
  return sequelize.transaction(async (transaction) => {
    const bet = await Bet.findByPk(betId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!bet) return { error: "apuesta no encontrada", status: 404 };
    const round = await Round.findByPk(bet.roundId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!OPEN_STATES.includes(round.state)) {
      return { error: "la ronda ya está cerrada", status: 409 };
    }
    if (bet.status === BET_STATUS.ANULADA || bet.status === BET_STATUS.DEVUELTA) {
      return { error: "la apuesta ya está anulada o devuelta", status: 409 };
    }
    if (bet.status === BET_STATUS.POOL) {
      if (bet.side === "red") round.poolRedCentimos -= bet.amountCentimos;
      else round.poolBlueCentimos -= bet.amountCentimos;
      const state = await loadPoolState(room, round, transaction);
      if (!secureNow(state) && round.state === CUENTA_REGRESIVA) {
        round.countdownRemainingMs = Math.max(
          0,
          round.countdownEndsAt.getTime() - now.getTime(),
        );
        round.countdownEndsAt = null;
        round.state = PAUSADA;
      }
    }
    bet.status = BET_STATUS.ANULADA;
    bet.annulReason = reason;
    await bet.save({ transaction });
    await round.save({ transaction });
    return { round, bet };
  }).then((result) => {
    if (result.round) emit(room.code, result.round);
    return result;
  });
}

// R24: devuelve (saldo a favor) una apuesta que sigue en espera.
export async function refundBet(room, betId, refundOperationNumber) {
  return sequelize.transaction(async (transaction) => {
    const bet = await Bet.findByPk(betId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!bet) return { error: "apuesta no encontrada", status: 404 };
    if (bet.status !== BET_STATUS.QUEUED) {
      return { error: "solo se devuelven apuestas en espera", status: 409 };
    }
    const round = await Round.findByPk(bet.roundId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!OPEN_STATES.includes(round.state)) {
      return { error: "la ronda ya está cerrada", status: 409 };
    }
    bet.status = BET_STATUS.DEVUELTA;
    bet.refundOperationNumber = refundOperationNumber;
    await bet.save({ transaction });
    return { round, bet };
  }).then((result) => {
    if (result.round) emit(room.code, result.round);
    return result;
  });
}

// Traslada las apuestas QUEUED de `from` al inicio de la cola de `to`.
async function carryQueue(from, to, transaction) {
  await Bet.update(
    { roundId: to.id },
    {
      where: {
        roundId: from.id,
        status: BET_STATUS.QUEUED,
        side: { [Op.ne]: null },
      },
      transaction,
    },
  );
  // Las "sin color" no tienen cola: también viajan a la ronda siguiente.
  await Bet.update(
    { roundId: to.id },
    {
      where: { roundId: from.id, status: BET_STATUS.QUEUED, side: null },
      transaction,
    },
  );
}

// R9: el resultado se guarda ANTES de la animación (CERRADA → GIRANDO) y
// jamás se resortea: si resultSlotId ya está poblado no se recalcula.
const closeAndSpin = (round, slots, now) => {
  if (!round.resultSlotId) {
    const { slot } = drawSlot(round.seed, slots);
    round.resultSlotId = slot.id;
  }
  round.state = CERRADA;
  round.countdownEndsAt = null;
  round.state = GIRANDO;
  round.girandoEndsAt = new Date(now.getTime() + SPIN_MS);
};



// Procesa todas las transiciones vencidas a `now`. Invocable desde tests.
export async function processExpiredRounds(now = new Date()) {
  const due = await Round.findAll({
    where: {
      [Op.or]: [
        { state: CUENTA_REGRESIVA, countdownEndsAt: { [Op.lte]: now } },
        { state: [ESPERANDO, CUENTA_REGRESIVA, PAUSADA], maxEndsAt: { [Op.lte]: now }, maxExpired: false },
        { state: GIRANDO, girandoEndsAt: { [Op.lte]: now } },
      ],
    },
    include: [{ model: Room, as: "room" }],
  });

  const processed = [];
  for (const round of due) {
    const roomCode = round.room.code;
    await sequelize.transaction(async (transaction) => {
      const locked = await Round.findByPk(round.id, {
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!locked) return;
      const room = await Room.findByPk(locked.roomId, { transaction });
      const state = await loadPoolState(room, locked, transaction);

      if (locked.state === GIRANDO) {
        // LIQUIDADA: semilla revelada (la 006 la usa para verificar)
        locked.state = LIQUIDADA;
        await locked.save({ transaction });
        const next = await lockOpenRound(room, transaction);
        await carryQueue(locked, next, transaction);
        const carried = await loadPoolState(room, next, transaction);
        const before = queuedBetsOf(carried);
        drain(carried);
        await persistState(next, before, carried, transaction);
        refreshTimers(next, carried, before.length - queuedBetsOf(carried).length, now);
        await next.save({ transaction });
        processed.push({ roundId: next.id, action: "opened" });
        emit(roomCode, next);
        processed.push({ roundId: locked.id, action: "liquidated" });
        emit(roomCode, locked);
        return;
      }

      const maxDue =
        locked.maxEndsAt !== null && locked.maxEndsAt <= now && !locked.maxExpired;
      const countdownDue =
        locked.state === CUENTA_REGRESIVA &&
        locked.countdownEndsAt !== null &&
        locked.countdownEndsAt <= now;

      if (maxDue) {
        const snapshot = queuedBetsOf(state).map((b) => ({ ...b }));
        const { spun } = equalize(state);
        if (spun) {
          await persistState(locked, snapshot, state, transaction);
          closeAndSpin(locked, await room.getSlots({ transaction }), now);
          processed.push({ roundId: locked.id, action: "equalized" });
        } else {
          locked.maxExpired = true;
          processed.push({ roundId: locked.id, action: "max_expired" });
        }
      } else if (countdownDue) {
        closeAndSpin(locked, await room.getSlots({ transaction }), now);
        processed.push({ roundId: locked.id, action: "closed" });
      } else {
        return;
      }
      await locked.save({ transaction });
      emit(roomCode, locked);
    });
  }
  return processed;
}

const publicSlot = (slot) =>
  slot ? { id: slot.id, side: slot.side, multiplier: slot.multiplier, weight: slot.weight } : null;

const resultOf = (round, slots) =>
  publicSlot(slots.find((s) => s.id === round.resultSlotId));

// Vista pública de la ronda actual de una sala.
export async function currentRoundView(room) {
  const round = await Round.findOne({
    where: { roomId: room.id, state: { [Op.ne]: LIQUIDADA } },
    order: [["seq", "DESC"]],
  });
  const open = round ?? (await sequelize.transaction((t) => lockOpenRound(room, t)));
  const [state, slots] = await Promise.all([
    loadPoolState(room, open),
    room.getSlots(),
  ]);
  return {
    seq: open.seq,
    state: open.state,
    pools: { red: open.poolRedCentimos, blue: open.poolBlueCentimos },
    queued: {
      red: open.state === LIQUIDADA ? 0 : state.queues.red.reduce((a, b) => a + b.amount, 0),
      blue: open.state === LIQUIDADA ? 0 : state.queues.blue.reduce((a, b) => a + b.amount, 0),
    },
    missing: {
      red: missingFor(state, "red"),
      blue: missingFor(state, "blue"),
    },
    countdownEndsAt: open.countdownEndsAt,
    maxEndsAt: open.maxEndsAt,
    girandoEndsAt: open.girandoEndsAt,
    seedHash: open.seedHash,
    resultSlotId: open.resultSlotId,
    result: resultOf(open, slots),
  };
}

// Vista del cajero: apuestas de la ronda abierta con datos del jugador.
export async function roundBetsView(room) {
  const round = await Round.findOne({
    where: { roomId: room.id, state: { [Op.ne]: LIQUIDADA } },
    order: [["seq", "DESC"]],
  });
  if (!round) return { seq: null, bets: [] };
  const bets = await Bet.findAll({
    where: { roundId: round.id },
    order: [["seq", "ASC"]],
  });
  return {
    seq: round.seq,
    state: round.state,
    open: OPEN_STATES.includes(round.state),
    bets: bets.map((b) => ({
      id: b.id,
      seq: b.seq,
      side: b.side,
      amountCentimos: b.amountCentimos,
      status: b.status,
      playerName: b.playerName,
      phone: b.phone,
      method: b.method,
      operationNumber: b.operationNumber,
      paymentVerified: b.paymentVerified,
      annulReason: b.annulReason,
      refundOperationNumber: b.refundOperationNumber,
    })),
  };
}

// Historial público: la semilla solo se expone una vez LIQUIDADA (R8).
export async function recentRoundsView(room, limit = 20) {
  const [rounds, slots] = await Promise.all([
    Round.findAll({
      where: { roomId: room.id },
      order: [["seq", "DESC"]],
      limit,
    }),
    room.getSlots(),
  ]);
  return rounds.map((r) => ({
    seq: r.seq,
    state: r.state,
    seedHash: r.seedHash,
    seed: r.state === LIQUIDADA ? r.seed : null,
    result: resultOf(r, slots),
    createdAt: r.createdAt,
  }));
}
