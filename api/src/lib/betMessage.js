// Heurística para autocompletar el formulario del cajero pegando el mensaje
// de WhatsApp (R18/R19). Formato esperado:
//   APUESTA · Sala GENERAL · ROJO · S/ 10.00 · Juan Pérez · 987654321
// Siempre es una ayuda: el cajero revisa y corrige antes de registrar.

const SIDE_RE = /\b(rojo|azul|red|blue)\b/i;
const AMOUNT_RE = /s\/\.?\s*(\d+(?:[.,]\d{1,2})?)/i;
const PHONE_RE = /\b(9\d{8})\b/;
const SIDE_LABEL = { red: "ROJO", blue: "AZUL" };

// R18: el mensaje que la página escribe por el jugador y que el cajero pega
// para autocompletar (R19). Generar y parsear comparten este formato.
// Los campos no pueden llevar el separador "·" (rompería el formato R18).
const safe = (v) => String(v ?? "").replace(/[·|]/g, "-").trim();

export function buildBetMessage({ roomName, side, amountCentimos, playerName, phone }) {
  const parts = ["APUESTA", `Sala ${safe(roomName)}`];
  if (side) parts.push(SIDE_LABEL[side]);
  parts.push(
    `S/ ${(amountCentimos / 100).toFixed(2)}`,
    safe(playerName),
    String(phone ?? "").replace(/\D/g, ""),
  );
  return parts.join(" · ");
}

export function parseBetMessage(text) {
  const out = {};
  if (typeof text !== "string" || !text.trim()) return out;

  const sideMatch = text.match(SIDE_RE);
  if (sideMatch) {
    out.side = /rojo|red/i.test(sideMatch[1]) ? "red" : "blue";
  }

  const amountMatch = text.match(AMOUNT_RE);
  if (amountMatch) {
    const soles = Number(amountMatch[1].replace(",", "."));
    if (Number.isFinite(soles)) {
      out.amountCentimos = Math.round(soles * 100);
    }
  }

  const phoneMatch = text.match(PHONE_RE);
  if (phoneMatch) {
    out.phone = phoneMatch[1];
  }

  // Nombre: el segmento antes del teléfono en el formato "… · Nombre · 9xx".
  const parts = text.split("·").map((p) => p.trim()).filter(Boolean);
  const phoneIdx = parts.findIndex((p) => PHONE_RE.test(p));
  const namePart = phoneIdx > 0 ? parts[phoneIdx - 1] : null;
  if (namePart && !SIDE_RE.test(namePart) && !AMOUNT_RE.test(namePart)) {
    out.playerName = namePart;
  }

  return out;
}
