import { DataTypes, Model } from "sequelize";

import { sequelize } from "../db.js";

export const ROLES = Object.freeze({ ADMIN: "admin", CASHIER: "cashier" });

export class User extends Model {}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    role: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: { isIn: [Object.values(ROLES)] },
    },
    username: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    credentialHash: {
      type: DataTypes.STRING(256),
      allowNull: false,
      field: "credential_hash",
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "users",
    underscored: true,
    defaultScope: {
      attributes: { exclude: ["credentialHash"] },
    },
    scopes: {
      withCredentials: { attributes: {} },
    },
  },
);

export function publicUser(user) {
  return {
    id: user.id,
    role: user.role,
    username: user.username,
    name: user.name,
    active: user.active,
  };
}
