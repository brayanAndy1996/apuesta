// Dominio puro del sorteo verificable (R7–R9).
// pos = BigInt("0x" + seed) % totalWeight, recorriendo las casillas en ORDEN
// CANÓNICO: primero "red" por multiplier ascendente, luego "blue" por
// multiplier ascendente. Cualquiera puede recomputar con la semilla revelada.

import { SIDES } from "./pool.js";

export const canonicalOrder = (slots) =>
  [...slots].sort((a, b) =>
    a.side === b.side
      ? a.multiplier - b.multiplier
      : a.side === SIDES.RED
        ? -1
        : 1,
  );

export function drawSlot(seed, slots) {
  if (!/^[0-9a-f]{64}$/i.test(seed)) {
    throw new Error("seed debe ser hex de 32 bytes");
  }
  const ordered = canonicalOrder(slots);
  const totalWeight = ordered.reduce((acc, s) => acc + s.weight, 0);
  if (totalWeight !== 100) {
    throw new Error(`los pesos deben sumar 100, suman ${totalWeight}`);
  }
  const pos = Number(BigInt(`0x${seed}`) % BigInt(totalWeight));
  let acc = 0;
  for (const slot of ordered) {
    acc += slot.weight;
    if (pos < acc) return { slot, pos };
  }
  throw new Error("unreachable: pos fuera de rango");
}
