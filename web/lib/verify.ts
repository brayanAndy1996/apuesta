// Verificador del sorteo (R7–R9, spec 011). Reproduce en el navegador lo que
// hace api/src/domain/draw.js:
//   pos = BigInt("0x" + seed) % 100, recorriendo las casillas en orden
//   canónico: primero rojo por multiplicador ascendente, luego azul.
// Cualquiera puede comprobar una ronda liquidada con la semilla revelada.

export type VerifySlot = {
  id: string;
  side: "red" | "blue";
  multiplier: number;
  weight: number;
};

const canonicalOrder = (slots: VerifySlot[]) =>
  [...slots].sort((a, b) =>
    a.side === b.side
      ? a.multiplier - b.multiplier
      : a.side === "red"
        ? -1
        : 1,
  );

export function drawPos(seed: string): number {
  return Number(BigInt(`0x${seed}`) % 100n);
}

export function drawSlot(seed: string, slots: VerifySlot[]) {
  const ordered = canonicalOrder(slots);
  const pos = drawPos(seed);
  let acc = 0;
  for (const slot of ordered) {
    acc += slot.weight;
    if (pos < acc) return { slot, pos };
  }
  return null;
}

// sha256 del string hex (igual que createHash("sha256").update(seed)).
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
