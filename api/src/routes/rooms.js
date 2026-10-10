import { Router } from "express";
import { z } from "zod";

import { buildBetMessage, parseBetMessage } from "../lib/betMessage.js";
import { requireAuth } from "../middleware/auth.js";
import { publicRoom, publicSlot, Room, RoomSlot } from "../models/room.js";
import {
  annulBet,
  assignBetSide,
  currentRoundView,
  payBet,
  placeBet,
  publicBetsView,
  recentRoundsView,
  refundBet,
  roundAccounting,
  roundBetsView,
  winnersView,
} from "../services/roundService.js";

export const roomsRouter = Router();

const findRoomByCode = async (code, { includeSlots = false } = {}) =>
  Room.findOne({
    where: { code: code.toUpperCase(), active: true },
    ...(includeSlots ? { include: [{ model: RoomSlot, as: "slots" }] } : {}),
  });

roomsRouter.get("/", async (_req, res, next) => {
  try {
    const rooms = await Room.findAll({
      where: { active: true },
      order: [["createdAt", "ASC"]],
    });
    res.json({
      rooms: rooms.map((room) => publicRoom(room, { includeSlots: false })),
    });
  } catch (err) {
    next(err);
  }
});

roomsRouter.get("/:code", async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code, { includeSlots: true });
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    res.json({ room: publicRoom(room), slots: room.slots.map(publicSlot) });
  } catch (err) {
    next(err);
  }
});

roomsRouter.get("/:code/round", async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    res.json({ round: await currentRoundView(room) });
  } catch (err) {
    next(err);
  }
});

roomsRouter.get("/:code/rounds", async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    res.json({ rounds: await recentRoundsView(room, limit) });
  } catch (err) {
    next(err);
  }
});

// R27: lista pública de apuestas de la ronda (datos enmascarados).
roomsRouter.get("/:code/public-bets", async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    res.json(await publicBetsView(room));
  } catch (err) {
    next(err);
  }
});

// R18: el jugador arma su apuesta; la API le devuelve el mensaje ya escrito
// y el enlace wa.me con el WhatsApp de la sala.
roomsRouter.get("/:code/bet-message", async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    const parsed = z
      .object({
        side: z.enum(["red", "blue"]).nullish(),
        amountCentimos: z.coerce.number().int().positive(),
        playerName: z.string().trim().min(1).max(160),
        phone: z.string().trim().min(1).max(32),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "parámetros inválidos" });
    }
    // El mensaje R18 identifica la sala por su código ("Sala GENERAL").
    const message = buildBetMessage({ roomName: room.code, ...parsed.data });
    const whatsapp = String(room.whatsapp ?? "").replace(/\D/g, "");
    res.json({
      message,
      whatsappUrl: `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`,
    });
  } catch (err) {
    next(err);
  }
});

const betSchema = z.object({
  side: z.enum(["red", "blue"]).nullish(),
  amountCentimos: z.number().int().positive(),
  playerName: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(1).max(32),
  method: z.enum(["yape", "plin"]),
  operationNumber: z.string().trim().min(1).max(64),
  paymentVerified: z.literal(true),
});

// Solo el cajero asignado a la sala (o el admin) toca sus apuestas.
const cashierOf = (room, user) =>
  user.role === "admin" || (user.role === "cashier" && room.cashierId === user.id);

const publicBet = (bet) => ({
  id: bet.id,
  seq: bet.seq,
  side: bet.side,
  amountCentimos: bet.amountCentimos,
  status: bet.status,
  playerName: bet.playerName,
  phone: bet.phone,
  method: bet.method,
  operationNumber: bet.operationNumber,
  paymentVerified: bet.paymentVerified,
  annulReason: bet.annulReason,
  refundOperationNumber: bet.refundOperationNumber,
  payoutCentimos: bet.payoutCentimos,
  paidOperationNumber: bet.paidOperationNumber,
  paidAt: bet.paidAt,
});

const reply = (res, result, okStatus = 200) =>
  result.error
    ? res.status(result.status).json({ error: result.error })
    : res.status(okStatus).json({
        bet: result.bet ? publicBet(result.bet) : undefined,
        bets: result.bets?.map(publicBet),
        parsed: result.parsed,
        round: { seq: result.round?.seq ?? null, state: result.round?.state ?? null },
      });

// R19: registro rápido — pago ya verificado en la app del cajero.
roomsRouter.post("/:code/bets", requireAuth, async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    if (!cashierOf(room, req.user)) {
      return res.status(403).json({ error: "sin permiso" });
    }
    const parsed = betSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "datos inválidos" });
    }
    const { amountCentimos, side } = parsed.data;
    if (side && amountCentimos < room.minBetCentimos) {
      return res.status(422).json({ error: `apuesta mínima: ${room.minBetCentimos} céntimos` });
    }
    const result = await placeBet(room, {
      ...parsed.data,
      cashierId: req.user.role === "cashier" ? req.user.id : null,
    });
    res.status(201).json({
      bets: result.bets.map(publicBet),
      round: { seq: result.round.seq, state: result.round.state },
    });
  } catch (err) {
    if (err.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ error: "número de operación ya registrado" });
    }
    next(err);
  }
});

// Bandeja del cajero: apuestas de la ronda abierta con datos del jugador.
roomsRouter.get("/:code/bets", requireAuth, async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    if (!cashierOf(room, req.user)) {
      return res.status(403).json({ error: "sin permiso" });
    }
    res.json(await roundBetsView(room));
  } catch (err) {
    next(err);
  }
});

const betAction = (fn) => async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    if (!cashierOf(room, req.user)) {
      return res.status(403).json({ error: "sin permiso" });
    }
    reply(res, await fn(room, req.params.betId, req.body, req.user));
  } catch (err) {
    next(err);
  }
};

// R22: aclarar el color de una apuesta de la bandeja "Sin color".
roomsRouter.patch(
  "/:code/bets/:betId",
  requireAuth,
  betAction((room, betId, body) => {
    const parsed = z.object({ side: z.enum(["red", "blue"]) }).safeParse(body);
    if (!parsed.success) {
      return { error: "datos inválidos", status: 400 };
    }
    return assignBetSide(room, betId, parsed.data.side);
  }),
);

// R23: anular antes del cierre con motivo.
roomsRouter.post(
  "/:code/bets/:betId/annul",
  requireAuth,
  betAction((room, betId, body) => {
    const parsed = z
      .object({ reason: z.string().trim().min(1).max(500) })
      .safeParse(body);
    if (!parsed.success) {
      return { error: "motivo requerido", status: 400 };
    }
    return annulBet(room, betId, parsed.data.reason);
  }),
);

// R25: marcar el premio como pagado con su nº de operación.
roomsRouter.post(
  "/:code/bets/:betId/pay",
  requireAuth,
  betAction((room, betId, body) => {
    const parsed = z
      .object({ operationNumber: z.string().trim().min(1).max(64) })
      .safeParse(body);
    if (!parsed.success) {
      return { error: "número de operación requerido", status: 400 };
    }
    return payBet(room, betId, parsed.data.operationNumber);
  }),
);

// R25: bandeja "Ganadores por pagar" (por defecto la última LIQUIDADA).
roomsRouter.get("/:code/winners", requireAuth, async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    if (!cashierOf(room, req.user)) {
      return res.status(403).json({ error: "sin permiso" });
    }
    const seq = req.query.seq === undefined ? null : Number(req.query.seq);
    if (seq !== null && !Number.isInteger(seq)) {
      return res.status(400).json({ error: "seq inválido" });
    }
    res.json(await winnersView(room, seq));
  } catch (err) {
    next(err);
  }
});

// R26: contabilidad por ronda — lo recibido queda trazado.
roomsRouter.get("/:code/rounds/:seq/accounting", requireAuth, async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    if (!cashierOf(room, req.user)) {
      return res.status(403).json({ error: "sin permiso" });
    }
    const seq = Number(req.params.seq);
    if (!Number.isInteger(seq)) {
      return res.status(400).json({ error: "seq inválido" });
    }
    const acc = await roundAccounting(room, seq);
    if (!acc) {
      return res.status(404).json({ error: "ronda no encontrada" });
    }
    res.json(acc);
  } catch (err) {
    next(err);
  }
});

// R24: devolver una apuesta en espera (saldo a favor).
roomsRouter.post(
  "/:code/bets/:betId/refund",
  requireAuth,
  betAction((room, betId, body) => {
    const parsed = z
      .object({ refundOperationNumber: z.string().trim().min(1).max(64) })
      .safeParse(body);
    if (!parsed.success) {
      return { error: "número de operación de devolución requerido", status: 400 };
    }
    return refundBet(room, betId, parsed.data.refundOperationNumber);
  }),
);

// Ayuda de autocompletado: pega el mensaje y propone los campos (R19).
roomsRouter.post(
  "/:code/bets/parse-message",
  requireAuth,
  betAction((room, _betId, body) => {
    const parsed = z.object({ message: z.string().max(2000) }).safeParse(body);
    if (!parsed.success) {
      return { error: "datos inválidos", status: 400 };
    }
    return { round: { seq: null, state: null }, parsed: parseBetMessage(parsed.data.message) };
  }),
);
