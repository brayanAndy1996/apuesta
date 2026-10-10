import { Router } from "express";
import { Op } from "sequelize";
import { z } from "zod";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { sequelize } from "../db.js";
import { validateSlots } from "../domain/slots.js";
import { generateRoomCode } from "../lib/roomCode.js";
import {
  DEFAULT_SLOTS,
  GENERAL_ROOM_CODE,
  publicRoom,
  publicSlot,
  Room,
  RoomSlot,
} from "../models/room.js";
import { ROLES, User } from "../models/user.js";

const createSchema = z.object({
  name: z.string().trim().min(1).max(128),
  whatsapp: z.string().trim().max(32).nullish(),
  yapeQr: z.string().max(4000).nullish(),
  plinQr: z.string().max(4000).nullish(),
  minBetCentimos: z.number().int().positive().optional(),
  maxBetCentimos: z.number().int().positive().optional(),
  cashierId: z.string().uuid().nullish(),
  slots: z
    .array(
      z.object({
        side: z.string(),
        multiplier: z.number().int(),
        weight: z.number().int(),
      }),
    )
    .optional(),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    whatsapp: z.string().trim().max(32).nullish(),
    yapeQr: z.string().max(4000).nullish(),
    plinQr: z.string().max(4000).nullish(),
    minBetCentimos: z.number().int().positive().optional(),
    maxBetCentimos: z.number().int().positive().optional(),
    cashierId: z.string().uuid().nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "nada que actualizar" });

const putSlotsSchema = z.object({
  slots: z.array(
    z.object({
      side: z.string(),
      multiplier: z.number().int(),
      weight: z.number().int(),
    }),
  ),
});

// Devuelve el cajero si puede asignarse a una sala; si no, { status, error }.
async function cashierAssignable(cashierId, excludeRoomId) {
  if (cashierId == null) return null;
  const cashier = await User.findByPk(cashierId);
  if (!cashier || cashier.role !== ROLES.CASHIER || !cashier.active) {
    return { status: 400, error: "el cajero no existe o no está activo" };
  }
  const taken = await Room.findOne({
    where: { cashierId, ...(excludeRoomId ? { id: { [Op.ne]: excludeRoomId } } : {}) },
  });
  if (taken) {
    return { status: 409, error: `el cajero ya atiende la sala ${taken.code}` };
  }
  return cashier;
}

async function generateUniqueCode() {
  for (;;) {
    const code = generateRoomCode();
    const exists = await Room.findOne({ where: { code } });
    if (!exists) return code;
  }
}

const include = [
  { model: RoomSlot, as: "slots" },
  { model: User, as: "cashier", attributes: ["id", "username", "name"] },
];

export const adminRoomsRouter = Router();

adminRoomsRouter.use(requireAuth, requireRole(ROLES.ADMIN));

adminRoomsRouter.get("/", async (_req, res, next) => {
  try {
    const rooms = await Room.findAll({ include, order: [["createdAt", "ASC"]] });
    res.json({ rooms: rooms.map((room) => publicRoom(room)) });
  } catch (err) {
    next(err);
  }
});

adminRoomsRouter.get("/:id", async (req, res, next) => {
  try {
    const room = await Room.findByPk(req.params.id, { include });
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    res.json({ room: publicRoom(room) });
  } catch (err) {
    next(err);
  }
});

adminRoomsRouter.post("/", async (req, res, next) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "datos inválidos", details: parsed.error.issues });
  }
  const data = parsed.data;

  if (
    data.minBetCentimos !== undefined &&
    data.maxBetCentimos !== undefined &&
    data.minBetCentimos >= data.maxBetCentimos
  ) {
    return res.status(400).json({ error: "el tope mínimo debe ser menor que el máximo" });
  }

  const slots = data.slots ?? DEFAULT_SLOTS;
  const slotErrors = validateSlots(slots);
  if (slotErrors.length > 0) {
    return res.status(400).json({ error: "casillas inválidas", details: slotErrors });
  }

  try {
    const cashier = await cashierAssignable(data.cashierId ?? null, null);
    if (cashier && cashier.status) {
      return res.status(cashier.status).json({ error: cashier.error });
    }

    const room = await sequelize.transaction(async (t) => {
      const created = await Room.create(
        {
          code: await generateUniqueCode(),
          name: data.name,
          whatsapp: data.whatsapp ?? null,
          yapeQr: data.yapeQr ?? null,
          plinQr: data.plinQr ?? null,
          minBetCentimos: data.minBetCentimos ?? 100,
          maxBetCentimos: data.maxBetCentimos ?? 5000,
          cashierId: cashier ? cashier.id : null,
        },
        { transaction: t },
      );
      await RoomSlot.bulkCreate(
        slots.map((slot) => ({ ...slot, roomId: created.id })),
        { transaction: t },
      );
      return created;
    });

    const full = await Room.findByPk(room.id, { include });
    res.status(201).json({ room: publicRoom(full) });
  } catch (err) {
    next(err);
  }
});

adminRoomsRouter.patch("/:id", async (req, res, next) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "datos inválidos", details: parsed.error.issues });
  }
  try {
    const room = await Room.findByPk(req.params.id);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    const data = parsed.data;

    const nextMin = data.minBetCentimos ?? room.minBetCentimos;
    const nextMax = data.maxBetCentimos ?? room.maxBetCentimos;
    if (nextMin >= nextMax) {
      return res.status(400).json({ error: "el tope mínimo debe ser menor que el máximo" });
    }

    if (data.cashierId !== undefined) {
      const cashier = await cashierAssignable(data.cashierId, room.id);
      if (cashier && cashier.status) {
        return res.status(cashier.status).json({ error: cashier.error });
      }
      room.cashierId = cashier ? cashier.id : null;
    }

    for (const field of ["name", "whatsapp", "yapeQr", "plinQr", "minBetCentimos", "maxBetCentimos", "active"]) {
      if (data[field] !== undefined) room[field] = data[field];
    }
    if (room.code === GENERAL_ROOM_CODE) {
      room.active = true; // la sala general no se desactiva
    }
    await room.save();

    const full = await Room.findByPk(room.id, { include });
    res.json({ room: publicRoom(full) });
  } catch (err) {
    next(err);
  }
});

adminRoomsRouter.put("/:id/slots", async (req, res, next) => {
  const parsed = putSlotsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "datos inválidos", details: parsed.error.issues });
  }
  const slotErrors = validateSlots(parsed.data.slots);
  if (slotErrors.length > 0) {
    return res.status(400).json({ error: "casillas inválidas", details: slotErrors });
  }
  try {
    const room = await Room.findByPk(req.params.id);
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    await sequelize.transaction(async (t) => {
      await RoomSlot.destroy({ where: { roomId: room.id }, transaction: t });
      await RoomSlot.bulkCreate(
        parsed.data.slots.map((slot) => ({ ...slot, roomId: room.id })),
        { transaction: t },
      );
    });
    const slots = await RoomSlot.findAll({ where: { roomId: room.id } });
    res.json({ slots: slots.map(publicSlot) });
  } catch (err) {
    next(err);
  }
});
