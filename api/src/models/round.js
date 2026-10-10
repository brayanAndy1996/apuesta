import { Model, DataTypes } from "sequelize";

import { sequelize } from "../db.js";
import { Room } from "./room.js";

export const ROUND_STATES = Object.freeze({
  ESPERANDO: "ESPERANDO",
  CUENTA_REGRESIVA: "CUENTA_REGRESIVA",
  PAUSADA: "PAUSADA",
  CERRADA: "CERRADA",
  GIRANDO: "GIRANDO",
  LIQUIDADA: "LIQUIDADA",
});

export const OPEN_STATES = Object.freeze([
  ROUND_STATES.ESPERANDO,
  ROUND_STATES.CUENTA_REGRESIVA,
  ROUND_STATES.PAUSADA,
]);

export const COUNTDOWN_MS = 60_000;
export const MAX_ROUND_MS = 300_000;
export const SPIN_MS = 7_000;

export const BET_STATUS = Object.freeze({ QUEUED: "QUEUED", POOL: "POOL" });

export class Round extends Model {}

Round.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    roomId: { type: DataTypes.UUID, allowNull: false, field: "room_id" },
    seq: { type: DataTypes.INTEGER, allowNull: false },
    state: {
      type: DataTypes.ENUM(...Object.values(ROUND_STATES)),
      allowNull: false,
      defaultValue: ROUND_STATES.ESPERANDO,
    },
    poolRedCentimos: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "pool_red_centimos",
    },
    poolBlueCentimos: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "pool_blue_centimos",
    },
    countdownEndsAt: { type: DataTypes.DATE, allowNull: true, field: "countdown_ends_at" },
    countdownRemainingMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "countdown_remaining_ms",
    },
    maxEndsAt: { type: DataTypes.DATE, allowNull: true, field: "max_ends_at" },
    maxExpired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "max_expired",
    },
    girandoEndsAt: { type: DataTypes.DATE, allowNull: true, field: "girando_ends_at" },
    seed: { type: DataTypes.TEXT, allowNull: true },
    seedHash: { type: DataTypes.TEXT, allowNull: false, field: "seed_hash" },
    resultSlotId: { type: DataTypes.UUID, allowNull: true, field: "result_slot_id" },
  },
  { sequelize, modelName: "round", tableName: "rounds", underscored: true },
);

export class Bet extends Model {}

Bet.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    roundId: { type: DataTypes.UUID, allowNull: false, field: "round_id" },
    seq: { type: DataTypes.INTEGER, allowNull: false },
    side: { type: DataTypes.ENUM("red", "blue"), allowNull: false },
    amountCentimos: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "amount_centimos",
    },
    status: {
      type: DataTypes.ENUM(BET_STATUS.QUEUED, BET_STATUS.POOL),
      allowNull: false,
      defaultValue: BET_STATUS.QUEUED,
    },
    parentBetId: { type: DataTypes.UUID, allowNull: true, field: "parent_bet_id" },
  },
  { sequelize, modelName: "bet", tableName: "bets", underscored: true },
);

Round.belongsTo(Room, { foreignKey: "roomId", as: "room" });
Room.hasMany(Round, { foreignKey: "roomId", as: "rounds" });
Round.hasMany(Bet, { foreignKey: "roundId", as: "bets" });
Bet.belongsTo(Round, { foreignKey: "roundId", as: "round" });
