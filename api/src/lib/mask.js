// R27: enmascarado de datos del jugador para la vista pública. Funciones
// puras; se prueban en test/mask.test.js.

// "Juan Pérez" → "Juan P."; "María" → "María".
export function publicName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  // Último token como apellido: "María José Quispe" → "María Q." (en Perú el
  // nombre puede ser compuesto; el apellido casi siempre está al final).
  return `${parts[0]} ${parts.at(-1)[0].toUpperCase()}.`;
}

// "999 888 777" → "*** *** 777" (solo últimos 3 dígitos visibles).
export function maskPhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `*** *** ${digits.slice(-3)}`;
}

// "Gana entre S/ X y S/ Y": monto × mín/máx multiplicador del color, en
// céntimos y con redondeo hacia abajo (R2). null si aún no tiene color.
export function winRangeCentimos(amountCentimos, slots, side) {
  if (!side) return null;
  const multipliers = slots.filter((s) => s.side === side).map((s) => s.multiplier);
  if (multipliers.length === 0) return null;
  const lo = Math.min(...multipliers);
  const hi = Math.max(...multipliers);
  return {
    min: Math.floor((amountCentimos * lo) / 100),
    max: Math.floor((amountCentimos * hi) / 100),
  };
}
