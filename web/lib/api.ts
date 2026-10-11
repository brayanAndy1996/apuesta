const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type Health = { status: string; db: string };

export type User = {
  id: string;
  role: "admin" | "cashier";
  username: string;
  name: string;
  active: boolean;
};

export type AuthResponse = { token: string; user: User };

async function request<T>(
  path: string,
  { method = "GET", body, token }: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

export async function getHealth(): Promise<Health> {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok && res.status !== 503) {
    throw new Error(`API respondió ${res.status}`);
  }
  return res.json() as Promise<Health>;
}

export async function loginAdmin(username: string, password: string) {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: { username, password },
  });
}

export async function loginCashier(username: string, pin: string) {
  return request<AuthResponse>("/auth/pin", {
    method: "POST",
    body: { username, pin },
  });
}

export async function getMe(token: string) {
  return request<{ user: User; room: { code: string; name: string } | null }>(
    "/auth/me",
    { token },
  );
}

export async function listCashiers(token: string) {
  return request<{ cashiers: User[] }>("/admin/cashiers", { token });
}

export type RoomSlot = {
  id?: string;
  side: "red" | "blue";
  multiplier: number;
  weight: number;
};

export type Room = {
  id: string;
  code: string;
  name: string;
  whatsappNumber: string | null;
  minBetCentimos: number;
  maxBetCentimos: number;
  active: boolean;
  cashier: User | null;
  slots?: RoomSlot[];
};

export async function listRooms(token: string) {
  return request<{ rooms: Room[] }>("/admin/rooms", { token });
}

export async function getRoom(token: string, id: string) {
  return request<{ room: Room }>(`/admin/rooms/${id}`, { token });
}

export async function createRoom(token: string, body: unknown) {
  return request<{ room: Room }>("/admin/rooms", {
    method: "POST",
    body,
    token,
  });
}

export async function updateRoom(token: string, id: string, body: unknown) {
  return request<{ room: Room }>(`/admin/rooms/${id}`, {
    method: "PATCH",
    body,
    token,
  });
}

export async function replaceSlots(token: string, id: string, slots: RoomSlot[]) {
  return request<{ slots: RoomSlot[] }>(`/admin/rooms/${id}/slots`, {
    method: "PUT",
    body: { slots },
    token,
  });
}

export type Bet = {
  id: string;
  seq: number;
  side: "red" | "blue" | null;
  amountCentimos: number;
  status: "QUEUED" | "POOL" | "ANULADA" | "DEVUELTA";
  playerName: string | null;
  phone: string | null;
  method: "yape" | "plin" | null;
  operationNumber: string | null;
  paymentVerified: boolean;
  annulReason: string | null;
  refundOperationNumber: string | null;
};

export type RoundView = {
  seq: number | null;
  state: string | null;
  open?: boolean;
};

// Vista pública en vivo (spec 009, R13/R27).
export type MissingRange = { min: number; max: number };

export type PublicRound = {
  seq: number;
  state: string;
  pools: { red: number; blue: number };
  queued: { red: number; blue: number };
  missing: { red: MissingRange | null; blue: MissingRange | null };
  blocked: { red: boolean; blue: boolean };
  countdownEndsAt: string | null;
  maxEndsAt: string | null;
  girandoEndsAt: string | null;
  seedHash: string;
  resultSlotId: string | null;
  result: { id: string; side: "red" | "blue"; multiplier: number; weight: number } | null;
};

export type PublicBet = {
  id: string;
  displayName: string | null;
  maskedPhone: string | null;
  side: "red" | "blue" | null;
  status: string;
  amountCentimos: number;
  isSimulated?: boolean;
  createdAt: string;
  winRangeCentimos: MissingRange | null;
};

export type PublicRoom = {
  id: string;
  code: string;
  name: string;
  whatsapp: string | null;
  yapeQr: string | null;
  plinQr: string | null;
  minBetCentimos: number;
  maxBetCentimos: number;
};

export async function getPublicRoom(code: string) {
  return request<{ room: PublicRoom; slots: RoomSlot[] }>(
    `/rooms/${code}`,
  );
}

export async function getPublicRound(code: string) {
  return request<{ round: PublicRound }>(`/rooms/${code}/round`);
}

export async function getBetMessage(
  code: string,
  params: { side?: "red" | "blue" | null; amountCentimos: number; playerName: string; phone: string },
) {
  const q = new URLSearchParams({
    amountCentimos: String(params.amountCentimos),
    playerName: params.playerName,
    phone: params.phone,
    ...(params.side ? { side: params.side } : {}),
  });
  return request<{ message: string; whatsappUrl: string }>(
    `/rooms/${code}/bet-message?${q}`,
  );
}

export async function getPublicBets(code: string) {
  return request<{ seq: number | null; bets: PublicBet[] }>(
    `/rooms/${code}/public-bets`,
  );
}

// Historial y estadísticas públicas (spec 011, R28).
export type HistoryRound = {
  seq: number;
  state: string;
  seedHash: string;
  seed: string | null;
  result: { id: string; side: "red" | "blue"; multiplier: number; weight: number } | null;
  createdAt: string;
};

export type SlotStats = {
  id: string;
  side: "red" | "blue";
  multiplier: number;
  weight: number;
  realCount: number;
  expectedCount: number;
  expectedPct: number;
  realPct: number | null;
};

export type RoomStats = {
  rounds: number;
  perColor: { red: number; blue: number };
  slots: SlotStats[];
};

export async function listRoundHistory(code: string, limit = 50) {
  return request<{ rounds: HistoryRound[] }>(
    `/rooms/${code}/rounds?limit=${limit}`,
  );
}

export async function getStats(code: string) {
  return request<RoomStats>(`/rooms/${code}/stats`);
}

export async function listBets(token: string, code: string) {
  return request<RoundView & { bets: Bet[] }>(`/rooms/${code}/bets`, { token });
}

export async function registerBet(token: string, code: string, body: unknown) {
  return request<{ bets: Bet[]; round: { seq: number; state: string } }>(
    `/rooms/${code}/bets`,
    { method: "POST", body, token },
  );
}

export async function assignBetSide(token: string, code: string, betId: string, side: "red" | "blue") {
  return request<{ bet: Bet }>(`/rooms/${code}/bets/${betId}`, {
    method: "PATCH",
    body: { side },
    token,
  });
}

export async function annulBet(token: string, code: string, betId: string, reason: string) {
  return request<{ bet: Bet }>(`/rooms/${code}/bets/${betId}/annul`, {
    method: "POST",
    body: { reason },
    token,
  });
}

export async function refundBet(token: string, code: string, betId: string, refundOperationNumber: string) {
  return request<{ bet: Bet }>(`/rooms/${code}/bets/${betId}/refund`, {
    method: "POST",
    body: { refundOperationNumber },
    token,
  });
}

export type Winner = {
  betId: string;
  playerName: string | null;
  phone: string | null;
  payoutCentimos: number;
  method: "yape" | "plin" | null;
  status: "PENDIENTE" | "PAGADA";
  paidOperationNumber: string | null;
};

export async function listWinners(token: string, code: string, seq?: number) {
  const q = seq === undefined ? "" : `?seq=${seq}`;
  return request<{ seq: number | null; winners: Winner[] }>(
    `/rooms/${code}/winners${q}`,
    { token },
  );
}

export async function payWinner(token: string, code: string, betId: string, operationNumber: string) {
  return request<{ bet: Bet }>(`/rooms/${code}/bets/${betId}/pay`, {
    method: "POST",
    body: { operationNumber },
    token,
  });
}

export async function parseMessage(token: string, code: string, message: string) {
  return request<{
    parsed: {
      side?: "red" | "blue";
      amountCentimos?: number;
      playerName?: string;
      phone?: string;
    };
  }>(`/rooms/${code}/bets/parse-message`, {
    method: "POST",
    body: { message },
    token,
  });
}

// R31: simulador de demo — genera apuestas ficticias marcadas.
export async function simulateBets(
  token: string,
  code: string,
  body: { count: number; side?: "red" | "blue" | null },
) {
  return request<{ bets: unknown[]; round: { seq: number; state: string } }>(
    `/rooms/${code}/simulate`,
    { method: "POST", body, token },
  );
}

// Reportes y auditoría del admin (spec 012, R23/R30).
export type DailyReport = {
  room: { code: string; name: string };
  date: string;
  rounds: number;
  bets: number;
  collectedCentimos: number;
  pooledCentimos: number;
  carriedCentimos: number;
  annulledCentimos: number;
  annulledCount: number;
  refundedCentimos: number;
  refundedCount: number;
  payoutsCentimos: number;
  payoutsPaidCentimos: number;
  winners: { total: number; paid: number; pending: number };
};

export type AuditEvent = {
  type: "ANULADA" | "DEVUELTA" | "PAGADA";
  at: string;
  roundSeq: number | null;
  betSeq: number;
  playerName: string | null;
  amountCentimos: number;
  payoutCentimos?: number;
  detail: string | null;
  actor: { id: string; name: string | null } | null;
};

export async function getDailyReport(token: string, code: string, date: string) {
  return request<DailyReport>(
    `/admin/reports/daily?code=${code}&date=${date}`,
    { token },
  );
}

export async function getAudit(token: string, code: string, date: string) {
  return request<{ events: AuditEvent[] }>(
    `/admin/audit?code=${code}&date=${date}`,
    { token },
  );
}
