// Liquidación de la ronda (R25): calcula el premio de cada apuesta en bolsa
// del color ganador con redondeo hacia abajo (R2), en céntimos enteros (R1).

export function settle(round, slots, bets) {
  const resultSlot = slots.find((s) => s.id === round.resultSlotId);
  if (!resultSlot) {
    throw new Error("la ronda no tiene casilla ganadora");
  }
  const payouts = [];
  for (const bet of bets) {
    if (bet.status !== "POOL") continue;
    if (bet.side !== resultSlot.side) continue;
    payouts.push({
      betId: bet.id,
      amount: Math.floor((bet.amountCentimos * resultSlot.multiplier) / 100),
    });
  }
  const poolTotal = round.poolRedCentimos + round.poolBlueCentimos;
  const paidOut = payouts.reduce((acc, p) => acc + p.amount, 0);
  return { payouts, paidOut, kept: poolTotal - paidOut };
}
