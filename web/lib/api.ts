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
