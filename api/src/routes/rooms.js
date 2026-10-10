import { Router } from "express";

import { publicRoom, publicSlot, Room, RoomSlot } from "../models/room.js";

export const roomsRouter = Router();

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
    const room = await Room.findOne({
      where: { code: req.params.code.toUpperCase(), active: true },
      include: [{ model: RoomSlot, as: "slots" }],
    });
    if (!room) {
      return res.status(404).json({ error: "sala no encontrada" });
    }
    res.json({ room: publicRoom(room), slots: room.slots.map(publicSlot) });
  } catch (err) {
    next(err);
  }
});
