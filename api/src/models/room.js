import { DataTypes, Model } from "sequelize";

import { sequelize } from "../db.js";
import { User } from "./user.js";

export const SIDES = Object.freeze({ RED: "red", BLUE: "blue" });
export const GENERAL_ROOM_CODE = "GENERAL";

// Casillas por defecto (R7): pico en 1.7, pesos simétricos, 50 por color.
// Nota: la tabla de planificacion.md (R7) suma 90 % (45 por color);
// se normaliza 1.7 a 20 para cumplir R6 (pesos = 100 %).
export const DEFAULT_SLOTS = Object.freeze([
  { side: SIDES.RED, multiplier: 150, weight: 5 },
  { side: SIDES.RED, multiplier: 160, weight: 10 },
  { side: SIDES.RED, multiplier: 170, weight: 20 },
  { side: SIDES.RED, multiplier: 180, weight: 10 },
  { side: SIDES.RED, multiplier: 190, weight: 5 },
  { side: SIDES.BLUE, multiplier: 150, weight: 5 },
  { side: SIDES.BLUE, multiplier: 160, weight: 10 },
  { side: SIDES.BLUE, multiplier: 170, weight: 20 },
  { side: SIDES.BLUE, multiplier: 180, weight: 10 },
  { side: SIDES.BLUE, multiplier: 190, weight: 5 },
]);

export class Room extends Model {}

Room.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    code: {
      type: DataTypes.STRING(8),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    whatsapp: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    yapeQr: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "yape_qr",
    },
    plinQr: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "plin_qr",
    },
    minBetCentimos: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 100,
      field: "min_bet_centimos",
    },
    maxBetCentimos: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5000,
      field: "max_bet_centimos",
    },
    cashierId: {
      type: DataTypes.UUID,
      allowNull: true,
      unique: true,
      field: "cashier_id",
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  { sequelize, tableName: "rooms", underscored: true },
);

export class RoomSlot extends Model {}

RoomSlot.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    roomId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "room_id",
    },
    side: {
      type: DataTypes.STRING(8),
      allowNull: false,
      validate: { isIn: [Object.values(SIDES)] },
    },
    multiplier: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 101, max: 199 },
    },
    weight: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1, max: 99 },
    },
  },
  { sequelize, tableName: "room_slots", underscored: true },
);

Room.hasMany(RoomSlot, { foreignKey: "roomId", as: "slots" });
RoomSlot.belongsTo(Room, { foreignKey: "roomId" });
Room.belongsTo(User, { foreignKey: "cashierId", as: "cashier" });
User.hasOne(Room, { foreignKey: "cashierId", as: "assignedRoom" });

export function publicSlot(slot) {
  return {
    side: slot.side,
    multiplier: slot.multiplier,
    weight: slot.weight,
  };
}

export function publicRoom(room, { includeSlots = true } = {}) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    whatsapp: room.whatsapp,
    yapeQr: room.yapeQr,
    plinQr: room.plinQr,
    minBetCentimos: room.minBetCentimos,
    maxBetCentimos: room.maxBetCentimos,
    active: room.active,
    cashier: room.cashier
      ? { id: room.cashier.id, username: room.cashier.username, name: room.cashier.name }
      : null,
    ...(includeSlots && room.slots
      ? { slots: room.slots.map(publicSlot) }
      : {}),
  };
}
