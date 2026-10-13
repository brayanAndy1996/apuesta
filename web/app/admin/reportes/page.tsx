"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import {
  getAudit,
  getDailyReport,
  getMe,
  listRooms,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/auth";

const soles = (c: number) => `S/ ${(c / 100).toFixed(2)}`;
const hora = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Lima",
  });

const todayLima = () =>
  new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);

const TIPO = {
  ANULADA: "bg-red-900/60 text-red-300",
  DEVUELTA: "bg-amber-900/60 text-amber-300",
  PAGADA: "bg-emerald-900/60 text-emerald-300",
} as const;

function Fila({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-neutral-800 py-1.5 text-sm last:border-0">
      <span className="text-neutral-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function ReportesPage() {
  const router = useRouter();
  const token = getToken();
  const [code, setCode] = useState("GENERAL");
  const [date, setDate] = useState(todayLima());

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe(token ?? ""),
    enabled: Boolean(token),
    retry: false,
  });
  useEffect(() => {
    if (!token || (me.data && me.data.status !== 200) || me.isError) {
      clearSession();
      router.replace("/login");
    }
  }, [token, me.data, me.isError, router]);

  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => listRooms(token ?? ""),
    enabled: Boolean(token),
  });
  const report = useQuery({
    queryKey: ["report", code, date],
    queryFn: () => getDailyReport(token ?? "", code, date),
    enabled: Boolean(token && code && date),
  });
  const audit = useQuery({
    queryKey: ["audit", code, date],
    queryFn: () => getAudit(token ?? "", code, date),
    enabled: Boolean(token && code && date),
  });

  const r = report.data?.data;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reportes por día</h1>
        <Link href="/admin" className="text-sm text-neutral-400 underline">
          ← Panel
        </Link>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
        >
          {(rooms.data?.data?.rooms ?? [{ code: "GENERAL", name: "Sala general" }]).map(
            (rm) => (
              <option key={rm.code} value={rm.code}>
                {rm.name} ({rm.code})
              </option>
            ),
          )}
        </select>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
        />
        <span className="text-xs text-neutral-500">día en hora de Lima</span>
      </div>

      {r && (
        <section className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-neutral-800 p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase text-neutral-400">
              Movimiento del día
            </h2>
            <Fila label="Rondas / apuestas" value={`${r.rounds} / ${r.bets}`} />
            <Fila label="Recibido" value={soles(r.collectedCentimos)} />
            <Fila label="En bolsa" value={soles(r.pooledCentimos)} />
            <Fila label="En espera" value={soles(r.carriedCentimos)} />
            <Fila
              label={`Anulado (${r.annulledCount})`}
              value={soles(r.annulledCentimos)}
            />
            <Fila
              label={`Devuelto (${r.refundedCount})`}
              value={soles(r.refundedCentimos)}
            />
          </div>
          <div className="rounded-lg border border-neutral-800 p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase text-neutral-400">
              Premios
            </h2>
            <Fila label="Premios generados" value={soles(r.payoutsCentimos)} />
            <Fila label="Ya pagados" value={soles(r.payoutsPaidCentimos)} />
            <Fila
              label="Ganadores"
              value={`${r.winners.total} (${r.winners.paid} pagados, ${r.winners.pending} pendientes)`}
            />
          </div>
        </section>
      )}

      <section className="rounded-lg border border-neutral-800 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase text-neutral-400">
          Auditoría del día
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-400">
              <th className="pb-1">Tipo</th>
              <th className="pb-1">Hora</th>
              <th className="pb-1">Apuesta</th>
              <th className="pb-1">Jugador</th>
              <th className="pb-1 text-right">Monto</th>
              <th className="pb-1">Detalle</th>
              <th className="pb-1">Cajero</th>
            </tr>
          </thead>
          <tbody>
            {(audit.data?.data?.events ?? []).map((e, i) => (
              <tr key={i} className="border-t border-neutral-800">
                <td className="py-1">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${TIPO[e.type]}`}>
                    {e.type}
                  </span>
                </td>
                <td className="py-1 text-neutral-500">{hora(e.at)}</td>
                <td className="py-1">
                  R#{e.roundSeq} · #{e.betSeq}
                </td>
                <td className="py-1">{e.playerName ?? "—"}</td>
                <td className="py-1 text-right">{soles(e.amountCentimos)}</td>
                <td className="max-w-40 truncate py-1 text-neutral-400">
                  {e.detail ?? "—"}
                </td>
                <td className="py-1 text-neutral-400">{e.actor?.name ?? "—"}</td>
              </tr>
            ))}
            {(audit.data?.data?.events ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="py-2 text-neutral-500">
                  Sin movimientos auditables este día.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
