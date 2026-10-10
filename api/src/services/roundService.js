import { Op, QueryTypes } from "sequelize";

import { sequelize } from "../db.js";
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
    seedHash: round.seedHash,
    ...extra,
  });
};

// Reconstruye el estado puro de la bolsa desde las filas persistidas.
async function loadPoolState(room, round, transaction) {
  const slots = await room.getSlots({ transaction });
  const state = createPool({ multMax: maxMultiplier(slots) });
  state.pools.red = round.poolRedCentimos;
  state.pools.blue = round.poolBlueCentimos;
  const queued = await Bet.findAll({
    where: { roundId: round.id, status: BET_STATUS.QUEUED },
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
  try {
    return await Round.create(
      {
        roomId: room.id,
        seq: (last ?? 0) + 1,
        state: ESPERANDO,
        seed,
        seedHash: seedHash(seed),
      },
      { transaction },
    );
  } catch (err) {
    // Otra transacción creó la ronda abierta primero (índice parcial único).
    if (err.name === "SequelizeUniqueConstraintError") {
      const retry = await findOpenRound(room, transaction);
      if (retry) return retry;
    }
    throw err;
  }
}

// Registra una apuesta y drena la bolsa. Devuelve { round, bet }.
export async function placeBet(room, { side, amountCentimos }, now = new Date()) {
  return sequelize.transaction(async (transaction) => {
    const round = await lockOpenRound(room, transaction);
    const [seqRow] = await sequelize.query(
      `SELECT MAX(b.seq) AS max_seq FROM bets b
       JOIN rounds r ON r.id = b.round_id
       WHERE r.room_id = :roomId`,
      {
        replacements: { roomId: room.id },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    const globalSeq = seqRow?.max_seq ?? 0;
    const bet = await Bet.create(
      {
        roundId: round.id,
        seq: globalSeq + 1,
        side,
        amountCentimos,
        status: BET_STATUS.QUEUED,
      },
      { transaction },
    );

    const state = await loadPoolState(room, round, transaction);
    // loadPoolState ya incluye la apuesta recién creada al final de su cola.
    const before = queuedBetsOf(state);
    drain(state);
    const admittedCount =
      before.length - queuedBetsOf(state).length;

    await persistState(round, before, state, transaction);
    refreshTimers(round, state, admittedCount, now);
    if (round.maxExpired && !secureNow(state)) {
      const snapshot = queuedBetsOf(state).map((b) => ({ ...b }));
      const { spun } = equalize(state);
      if (spun) {
        await persistState(round, snapshot, state, transaction);
        closeAndSpin(round, now);
      }
    }
    await round.save({ transaction });
    bet.status = queuedBetsOf(state).some((q) => q.id === bet.id)
      ? BET_STATUS.QUEUED
      : BET_STATUS.POOL;
    return { round, bet };
  }).then((result) => {
    emit(room.code, result.round);
    return result;
  });
}

const closeAndSpin = (round, now) => {
  round.state = CERRADA;
  round.countdownEndsAt = null;
  // CERRADA → GIRANDO de inmediato: en la 006 aquí se guarda el resultado.
  round.state = GIRANDO;
  round.girandoEndsAt = new Date(now.getTime() + SPIN_MS);
};

// Traslada las apuestas QUEUED de `from` al inicio de la cola de `to`.
async function carryQueue(from, to, transaction) {
  await Bet.update(
    { roundId: to.id },
    { where: { roundId: from.id, status: BET_STATUS.QUEUED }, transaction },
  );
}

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
          closeAndSpin(locked, now);
          processed.push({ roundId: locked.id, action: "equalized" });
        } else {
          locked.maxExpired = true;
          processed.push({ roundId: locked.id, action: "max_expired" });
        }
      } else if (countdownDue) {
        closeAndSpin(locked, now);
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

// Vista pública de la ronda actual de una sala.
export async function currentRoundView(room) {
  const round = await Round.findOne({
    where: { roomId: room.id, state: { [Op.ne]: LIQUIDADA } },
    order: [["seq", "DESC"]],
  });
  const open = round ?? (await sequelize.transaction((t) => lockOpenRound(room, t)));
  const state = await loadPoolState(room, open);
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
  };
}
