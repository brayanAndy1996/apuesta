import { Router } from "express";
import { z } from "zod";

import { validateBet } from "../domain/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { publicRoom, publicSlot, Room, RoomSlot } from "../models/room.js";
import {
  currentRoundView,
  placeBet,
  recentRoundsView,
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

const betSchema = z.object({
  side: z.enum(["red", "blue"]),
  amountCentimos: z.number().int(),
});

// Provisional hasta la spec 007 (registro completo del cajero):
// el cajero debe estar asignado a la sala; el admin puede apostar en cualquiera.
roomsRouter.post("/:code/bets", requireAuth, async (req, res, next) => {
  try {
    const room = await findRoomByCode(req.params.code);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    const { role, id: userId } = req.user;
    if (role !== "admin" && !(role === "cashier" && room.cashierId === userId)) {
      return res.status(403).json({ error: "sin permiso" });
    }
    const parsed = betSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "datos inválidos" });
    }
    const err = validateBet(
      parsed.data.amountCentimos,
      room.minBetCentimos,
      room.maxBetCentimos,
    );
    if (err) {
      return res.status(422).json({ error: err });
    }
    const { round, bet } = await placeBet(room, parsed.data);
    res.status(201).json({
      bet: {
        id: bet.id,
        seq: bet.seq,
        side: bet.side,
        amountCentimos: bet.amountCentimos,
        status: bet.status,
      },
      round: { seq: round.seq, state: round.state },
    });
  } catch (err) {
    next(err);
  }
});
