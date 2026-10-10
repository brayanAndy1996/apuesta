"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  annulBet,
  assignBetSide,
  getMe,
  listBets,
  parseMessage,
  refundBet,
  registerBet,
  type Bet,
} from "@/lib/api";
import { clearSession, getStoredUser, getToken } from "@/lib/auth";

const soles = (centimos: number) => `S/ ${(centimos / 100).toFixed(2)}`;

export default function CajeroPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = getToken();
  const [message, setMessage] = useState("");
  const [side, setSide] = useState<"red" | "blue" | "">("");
  const [amount, setAmount] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"yape" | "plin">("yape");
  const [operationNumber, setOperationNumber] = useState("");
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe(token ?? ""),
    enabled: Boolean(token),
    retry: false,
  });
  const code = me.data?.data?.room?.code ?? null;

  const betsQuery = useQuery({
    queryKey: ["bets", code],
    queryFn: () => listBets(token ?? "", code ?? ""),
    enabled: Boolean(token && code),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!token || me.isError || (me.data && me.data.status !== 200)) {
      clearSession();
      router.replace("/login");
    }
  }, [token, me.data, me.isError, router]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["bets", code] });
  const apiError = (res: { status: number; data: unknown }) =>
    (res.data as { error?: string }).error ?? `error ${res.status}`;

  const autofill = useMutation({
    mutationFn: () => parseMessage(token ?? "", code ?? "", message),
    onSuccess: (res) => {
      const p = res.data?.parsed ?? {};
      if (p.side) setSide(p.side);
      if (p.amountCentimos) setAmount((p.amountCentimos / 100).toFixed(2));
      if (p.playerName) setPlayerName(p.playerName);
      if (p.phone) setPhone(p.phone);
    },
  });

  const submit = useMutation({
    mutationFn: (body: unknown) => registerBet(token ?? "", code ?? "", body),
    onSuccess: (res) => {
      if (res.status === 201) {
        setMessage("");
        setSide("");
        setAmount("");
        setPlayerName("");
        setPhone("");
        setOperationNumber("");
        setVerified(false);
        setError(null);
        setNotice("Apuesta registrada");
        invalidate();
      } else {
        setError(apiError(res));
        setNotice(null);
      }
    },
  });

  const action = useMutation({
    mutationFn: (fn: () => Promise<{ status: number; data: unknown }>) => fn(),
    onSuccess: (res) => {
      if (res.status === 200) {
        setError(null);
        invalidate();
      } else {
        setError(apiError(res));
      }
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const centimos = Math.round(Number(amount) * 100);
    if (!Number.isFinite(centimos) || centimos <= 0) {
      setError("Monto inválido");
      return;
    }
    submit.mutate({
      side: side || null,
      amountCentimos: centimos,
      playerName,
      phone,
      method,
      operationNumber,
      paymentVerified: verified,
    });
  };

  const stored = getStoredUser();
  const bets: Bet[] = betsQuery.data?.data?.bets ?? [];
  const open = betsQuery.data?.data?.open ?? true;
  const sinColor = bets.filter((b) => b.side === null && b.status === "QUEUED");
  const rest = bets.filter((b) => b.side !== null);
  const active = rest.filter((b) => b.status === "QUEUED" || b.status === "POOL");
  const done = rest.filter((b) => b.status !== "QUEUED" && b.status !== "POOL");

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Panel de cajero</h1>
      {stored && (
        <p className="text-sm text-neutral-400">
          {stored.name} · {me.data?.data?.room?.name ?? "sin sala asignada"} ·
          ronda {betsQuery.data?.data?.seq ?? "—"} ({betsQuery.data?.data?.state ?? "…"})
        </p>
      )}
      {!code && me.data && (
        <p className="mt-4 text-amber-400">No tienes una sala asignada.</p>
      )}

      {code && (
        <>
          <form onSubmit={onSubmit} className="mt-6 space-y-3 rounded border border-neutral-800 p-4">
            <h2 className="font-semibold">Registrar apuesta</h2>
            <textarea
              className="w-full rounded bg-neutral-900 p-2 text-sm"
              rows={2}
              placeholder="Pega aquí el mensaje de WhatsApp…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onBlur={() => message.trim() && autofill.mutate()}
            />
            <div className="flex gap-3">
              <select
                className="rounded bg-neutral-900 p-2"
                value={side}
                onChange={(e) => setSide(e.target.value as "red" | "blue" | "")}
              >
                <option value="">Sin color</option>
                <option value="red">Rojo</option>
                <option value="blue">Azul</option>
              </select>
              <input
                className="w-28 rounded bg-neutral-900 p-2"
                placeholder="S/ 10.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              <input
                className="flex-1 rounded bg-neutral-900 p-2"
                placeholder="Nombre y apellido"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                required
              />
              <input
                className="w-32 rounded bg-neutral-900 p-2"
                placeholder="Teléfono"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="flex items-center gap-3">
              <select
                className="rounded bg-neutral-900 p-2"
                value={method}
                onChange={(e) => setMethod(e.target.value as "yape" | "plin")}
              >
                <option value="yape">Yape</option>
                <option value="plin">Plin</option>
              </select>
              <input
                className="w-40 rounded bg-neutral-900 p-2"
                placeholder="Nº de operación"
                value={operationNumber}
                onChange={(e) => setOperationNumber(e.target.value)}
                required
              />
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                  required
                />
                Pago verificado
              </label>
              <button
                type="submit"
                className="rounded bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-50"
                disabled={submit.isPending || !open}
              >
                Registrar
              </button>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            {notice && <p className="text-sm text-emerald-400">{notice}</p>}
          </form>

          {sinColor.length > 0 && (
            <section className="mt-6">
              <h2 className="font-semibold text-amber-400">Sin color</h2>
              <ul className="mt-2 space-y-1">
                {sinColor.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 rounded border border-amber-900/50 p-2 text-sm">
                    <span className="flex-1">
                      {b.playerName} · {soles(b.amountCentimos)} · {b.method} {b.operationNumber}
                    </span>
                    <button className="rounded bg-red-800 px-2 py-1" onClick={() => action.mutate(() => assignBetSide(token ?? "", code, b.id, "red"))}>Rojo</button>
                    <button className="rounded bg-blue-800 px-2 py-1" onClick={() => action.mutate(() => assignBetSide(token ?? "", code, b.id, "blue"))}>Azul</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-6">
            <h2 className="font-semibold">Apuestas de la ronda</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {active.map((b) => (
                <li key={b.id} className="flex items-center gap-2 rounded border border-neutral-800 p-2">
                  <span className={b.side === "red" ? "text-red-400" : "text-blue-400"}>
                    {b.side === "red" ? "Rojo" : "Azul"}
                  </span>
                  <span className="flex-1">
                    {b.playerName} · {soles(b.amountCentimos)} · {b.method} {b.operationNumber}
                  </span>
                  <span className="text-neutral-500">{b.status === "POOL" ? "en bolsa" : "en espera"}</span>
                  {open && (
                    <>
                      <button
                        className="rounded bg-neutral-700 px-2 py-1"
                        onClick={() => {
                          const reason = window.prompt("Motivo de la anulación");
                          if (reason) action.mutate(() => annulBet(token ?? "", code, b.id, reason));
                        }}
                      >
                        Anular
                      </button>
                      {b.status === "QUEUED" && (
                        <button
                          className="rounded bg-neutral-700 px-2 py-1"
                          onClick={() => {
                            const op = window.prompt("Nº de operación de la devolución");
                            if (op) action.mutate(() => refundBet(token ?? "", code, b.id, op));
                          }}
                        >
                          Devolver
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
              {active.length === 0 && <li className="text-neutral-500">Sin apuestas todavía.</li>}
            </ul>
          </section>

          {done.length > 0 && (
            <section className="mt-6">
              <h2 className="font-semibold text-neutral-400">Historial de la ronda</h2>
              <ul className="mt-2 space-y-1 text-sm text-neutral-500">
                {done.map((b) => (
                  <li key={b.id} className="rounded border border-neutral-800/60 p-2">
                    {b.status === "ANULADA" ? "Anulada" : "Devuelta"} · {b.playerName} · {soles(b.amountCentimos)}
                    {b.annulReason && ` · ${b.annulReason}`}
                    {b.refundOperationNumber && ` · dev. ${b.refundOperationNumber}`}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
