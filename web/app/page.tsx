"use client";

import { useQuery } from "@tanstack/react-query";

import { getHealth } from "@/lib/api";

export default function Home() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Ruleta Rápida</h1>
      <p className="text-neutral-400">Demo con dinero ficticio</p>
      <a
        className="rounded border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800"
        href="/login"
      >
        Entrar (admin / cajero)
      </a>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Estado de la API
        </h2>
        {health.isLoading && <p>Consultando…</p>}
        {health.isError && (
          <p className="text-red-400">API no disponible</p>
        )}
        {health.data && (
          <p>
            API: {health.data.status} · BD: {health.data.db}
          </p>
        )}
      </div>
    </main>
  );
}
