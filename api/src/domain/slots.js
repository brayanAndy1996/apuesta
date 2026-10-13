// Validación de casillas de ruleta (R6), pura: sin BD ni Express.

import { SIDES } from "../models/room.js";

export const MULTIPLIER_MIN = 101;
export const MULTIPLIER_MAX = 199;
export const WEIGHT_TOTAL = 100;

// Devuelve lista de errores; [] significa válido.
export function validateSlots(slots) {
  const errors = [];

  if (!Array.isArray(slots) || slots.length === 0) {
    return ["debe haber al menos una casilla"];
  }

  const sides = new Set();
  let totalWeight = 0;

  for (const [i, slot] of slots.entries()) {
    const label = `casilla ${i + 1}`;

    if (slot.side !== SIDES.RED && slot.side !== SIDES.BLUE) {
      errors.push(`${label}: color debe ser "red" o "blue"`);
    } else {
      sides.add(slot.side);
    }

    if (!Number.isInteger(slot.multiplier) || slot.multiplier < MULTIPLIER_MIN || slot.multiplier > MULTIPLIER_MAX) {
      errors.push(`${label}: multiplicador debe ser entero entre 1.01 y 1.99`);
    }

    if (!Number.isInteger(slot.weight) || slot.weight < 1 || slot.weight > 99) {
      errors.push(`${label}: peso debe ser entero entre 1 y 99`);
    } else {
      totalWeight += slot.weight;
    }
  }

  if (totalWeight !== WEIGHT_TOTAL) {
    errors.push(`los pesos deben sumar 100 (suman ${totalWeight})`);
  }

  for (const side of Object.values(SIDES)) {
    if (!sides.has(side)) {
      errors.push(`falta al menos una casilla del color ${side}`);
    }
  }

  return errors;
}
