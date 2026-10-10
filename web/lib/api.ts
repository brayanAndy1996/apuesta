const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type Health = { status: string; db: string };

export async function getHealth(): Promise<Health> {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok && res.status !== 503) {
    throw new Error(`API respondió ${res.status}`);
  }
  return res.json() as Promise<Health>;
}
