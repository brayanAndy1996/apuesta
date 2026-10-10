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
  return request<{ user: User }>("/auth/me", { token });
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
