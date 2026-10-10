import { Model, DataTypes, Op } from "sequelize";

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

export const BET_STATUS = Object.freeze({
  QUEUED: "QUEUED",
  POOL: "POOL",
  ANULADA: "ANULADA",
  DEVUELTA: "DEVUELTA",
});

export const PAYMENT_METHODS = Object.freeze({ YAPE: "yape", PLIN: "plin" });

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
    // null = bandeja "Sin color" (R22): aún no entra a la cola del dominio.
    side: { type: DataTypes.ENUM("red", "blue"), allowNull: true },
    amountCentimos: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "amount_centimos",
    },
    status: {
      type: DataTypes.ENUM(...Object.values(BET_STATUS)),
      allowNull: false,
      defaultValue: BET_STATUS.QUEUED,
    },
    parentBetId: { type: DataTypes.UUID, allowNull: true, field: "parent_bet_id" },
    playerName: { type: DataTypes.STRING(160), allowNull: true, field: "player_name" },
    phone: { type: DataTypes.STRING(32), allowNull: true },
    method: {
      type: DataTypes.ENUM(...Object.values(PAYMENT_METHODS)),
      allowNull: true,
    },
    operationNumber: { type: DataTypes.STRING(64), allowNull: true, field: "operation_number" },
    paymentVerified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "payment_verified",
    },
    cashierId: { type: DataTypes.UUID, allowNull: true, field: "cashier_id" },
    annulReason: { type: DataTypes.TEXT, allowNull: true, field: "annul_reason" },
    refundOperationNumber: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "refund_operation_number",
    },
  },
  {
    sequelize,
    modelName: "bet",
    tableName: "bets",
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["method", "operation_number"],
        name: "bets_operation_unique",
        where: { operation_number: { [Op.ne]: null } },
      },
    ],
  },
);

Round.belongsTo(Room, { foreignKey: "roomId", as: "room" });
Room.hasMany(Round, { foreignKey: "roomId", as: "rounds" });
Round.hasMany(Bet, { foreignKey: "roundId", as: "bets" });
Bet.belongsTo(Round, { foreignKey: "roundId", as: "round" });
