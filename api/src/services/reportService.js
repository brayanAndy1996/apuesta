// Spec 012 (R23, R30): reportes por sala y día + auditoría del cajero.
// Día = calendario America/Lima (fijo -05:00, sin DST).

import { Op } from "sequelize";

import { BET_STATUS, Bet, Round } from "../models/round.js";
import { User } from "../models/user.js";

// "2026-10-10" → [00:00 Lima, 00:00 Lima+1d) en UTC. null si malformada.
export function limaDayRange(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr ?? ""))) return null;
  const start = new Date(`${dateStr}T00:00:00-05:00`);
  if (Number.isNaN(start.getTime())) return null;
  return [start, new Date(start.getTime() + 24 * 3600 * 1000)];
}

const sum = (bets) => bets.reduce((acc, b) => acc + b.amountCentimos, 0);

// Rondas de la sala creadas en el día Lima + agregado de sus apuestas.
export async function dailyReport(room, dateStr) {
  const range = limaDayRange(dateStr);
  if (!range) return { error: "date inválida", status: 400 };
  const [from, to] = range;

  const rounds = await Round.findAll({
    where: { roomId: room.id, createdAt: { [Op.gte]: from, [Op.lt]: to } },
    attributes: ["id", "seq"],
  });
  const roundIds = rounds.map((r) => r.id);
  const bets = roundIds.length
    ? await Bet.findAll({
        where: { originRoundId: { [Op.in]: roundIds } },
      })
    : [];

  const pooled = sum(bets.filter((b) => b.status === BET_STATUS.POOL));
  const carried = sum(bets.filter((b) => b.status === BET_STATUS.QUEUED));
  const annulledBets = bets.filter((b) => b.status === BET_STATUS.ANULADA);
  const refundedBets = bets.filter((b) => b.status === BET_STATUS.DEVUELTA);
  const winners = bets.filter(
    (b) => b.status === BET_STATUS.POOL && b.payoutCentimos > 0,
  );
  const paid = winners.filter((b) => b.paidAt !== null);
  const payoutSum = (list) => list.reduce((acc, b) => acc + b.payoutCentimos, 0);

  return {
    room: { code: room.code, name: room.name },
    date: dateStr,
    rounds: rounds.length,
    bets: bets.length,
    collectedCentimos: sum(bets),
    pooledCentimos: pooled,
    carriedCentimos: carried,
    annulledCentimos: sum(annulledBets),
    annulledCount: annulledBets.length,
    refundedCentimos: sum(refundedBets),
    refundedCount: refundedBets.length,
    payoutsCentimos: payoutSum(winners),
    payoutsPaidCentimos: payoutSum(paid),
    winners: {
      total: winners.length,
      paid: paid.length,
      pending: winners.length - paid.length,
    },
  };
}

// Eventos de auditoría del día: ANULADA / DEVUELTA / PAGADA con actor.
export async function auditView(room, dateStr) {
  const range = limaDayRange(dateStr);
  if (!range) return { error: "date inválida", status: 400 };
  const [from, to] = range;

  const rounds = await Round.findAll({
    where: { roomId: room.id, createdAt: { [Op.gte]: from, [Op.lt]: to } },
    attributes: ["id", "seq"],
  });
  const roundSeq = new Map(rounds.map((r) => [r.id, r.seq]));
  const roundIds = rounds.map((r) => r.id);
  if (roundIds.length === 0) return { events: [] };

  const bets = await Bet.findAll({
    where: {
      originRoundId: { [Op.in]: roundIds },
      [Op.or]: [
        { status: BET_STATUS.ANULADA },
        { status: BET_STATUS.DEVUELTA },
        { paidAt: { [Op.ne]: null } },
      ],
    },
  });

  const actorIds = [
    ...new Set(
      bets
        .flatMap((b) => [b.annulledById, b.refundedById, b.paidById])
        .filter(Boolean),
    ),
  ];
  const actors = new Map(
    (await User.findAll({ where: { id: { [Op.in]: actorIds } } })).map((u) => [
      u.id,
      u.name,
    ]),
  );
  const actorOf = (id) =>
    id ? { id, name: actors.get(id) ?? null } : null;

  const events = [];
  for (const b of bets) {
    const base = {
      roundSeq: roundSeq.get(b.originRoundId) ?? null,
      betSeq: b.seq,
      playerName: b.playerName,
      amountCentimos: b.amountCentimos,
    };
    if (b.status === BET_STATUS.ANULADA) {
      events.push({
        ...base,
        type: "ANULADA",
        at: b.updatedAt,
        detail: b.annulReason,
        actor: actorOf(b.annulledById),
      });
    }
    if (b.status === BET_STATUS.DEVUELTA) {
      events.push({
        ...base,
        type: "DEVUELTA",
        at: b.updatedAt,
        detail: b.refundOperationNumber,
        actor: actorOf(b.refundedById),
      });
    }
    if (b.paidAt !== null) {
      events.push({
        ...base,
        type: "PAGADA",
        at: b.paidAt,
        payoutCentimos: b.payoutCentimos,
        detail: b.paidOperationNumber,
        actor: actorOf(b.paidById),
      });
    }
  }
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return { events: events.slice(0, 200) };
}
