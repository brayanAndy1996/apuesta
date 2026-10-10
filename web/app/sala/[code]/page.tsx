"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getPublicBets,
  getPublicRoom,
  getPublicRound,
  type PublicBet,
  type PublicRound,
} from "@/lib/api";
import { roomSocket } from "@/lib/socket";

const soles = (centimos: number) => `S/ ${(centimos / 100).toFixed(2)}`;
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Lima",
  });
const mult = (m: number) => `${(m / 100).toFixed(2)}`;

const COLOR_LABEL = { red: "Rojo", blue: "Azul" } as const;

function Estado({ state }: { state: string }) {
  const label = {
    ESPERANDO: "Esperando apuestas",
    CUENTA_REGRESIVA: "Cuenta regresiva",
    PAUSADA: "Esperando igualación",
    CERRADA: "Cerrada",
    GIRANDO: "¡Girando!",
    LIQUIDADA: "Ronda liquidada",
  }[state] ?? state;
  return <span className="rounded bg-neutral-800 px-2 py-1 text-xs uppercase">{label}</span>;
}

function Countdown({ endsAt }: { endsAt: string }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () =>
      setLeft(Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [endsAt]);
  return <span className="text-5xl font-black tabular-nums">{left}s</span>;
}

function PoolCard({
  side,
  round,
}: {
  side: "red" | "blue";
  round: PublicRound;
}) {
  const missing = round.missing[side];
  const blocked = round.blocked[side];
  const color = side === "red" ? "text-red-400" : "text-blue-400";
  const border = side === "red" ? "border-red-900/60" : "border-blue-900/60";
  return (
    <div className={`flex-1 rounded-lg border ${border} bg-neutral-900 p-4`}>
      <h3 className={`text-sm font-semibold uppercase ${color}`}>{COLOR_LABEL[side]}</h3>
      <p className="mt-1 text-3xl font-bold">{soles(round.pools[side])}</p>
      <p className="mt-1 text-xs text-neutral-400">
        en bolsa · {soles(round.queued[side])} en espera
      </p>
      {blocked && missing && (
        <p className="mt-2 rounded bg-amber-950/60 px-2 py-1 text-xs text-amber-300">
          Falta {soles(missing.min)}–{soles(missing.max)} del otro color
        </p>
      )}
      {blocked && !missing && (
        <p className="mt-2 text-xs text-amber-300">Bloqueado</p>
      )}
    </div>
  );
}

function Roulette({ round }: { round: PublicRound }) {
  const spinning = round.state === "GIRANDO";
  const [idx, setIdx] = useState(0);
  const options = [150, 160, 170, 180, 190];
  useEffect(() => {
    if (!spinning) return;
    const t = setInterval(() => setIdx((i) => i + 1), 120);
    return () => clearInterval(t);
  }, [spinning]);

  const shown = spinning
    ? { multiplier: options[idx % options.length], side: idx % 2 ? "blue" : "red" }
    : round.result;

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-6">
      {spinning ? (
        <>
          <div
            className={`text-6xl font-black ${shown?.side === "red" ? "text-red-400" : "text-blue-400"}`}
          >
            {shown ? `×${mult(shown.multiplier)}` : "…"}
          </div>
          <p className="animate-pulse text-sm text-neutral-400">Girando…</p>
        </>
      ) : round.result ? (
        <>
          <div
            className={`text-6xl font-black ${round.result.side === "red" ? "text-red-400" : "text-blue-400"}`}
          >
            {COLOR_LABEL[round.result.side]} ×{mult(round.result.multiplier)}
          </div>
          <p className="text-sm text-neutral-400">Resultado de la ronda</p>
        </>
      ) : (
        <p className="text-neutral-500">La ruleta aún no ha girado</p>
      )}
    </div>
  );
}

function BetList({ bets }: { bets: PublicBet[] }) {
  if (bets.length === 0) {
    return <p className="text-sm text-neutral-500">Aún no hay apuestas en esta ronda.</p>;
  }
  return (
    <ul className="divide-y divide-neutral-800 text-sm">
      {bets.map((b) => (
        <li key={b.id} className="flex items-center gap-2 py-2">
          <span className="w-14 text-neutral-500">{hora(b.createdAt)}</span>
          <span className="flex-1 font-medium">{b.displayName ?? "—"}</span>
          <span className="text-neutral-400">{b.maskedPhone ?? ""}</span>
          <span
            className={
              b.side === "red"
                ? "rounded bg-red-950 px-2 py-0.5 text-red-300"
                : b.side === "blue"
                  ? "rounded bg-blue-950 px-2 py-0.5 text-blue-300"
                  : "rounded bg-neutral-800 px-2 py-0.5 text-neutral-400"
            }
          >
            {b.side ? COLOR_LABEL[b.side] : "sin color"}
          </span>
          <span className="w-20 text-right font-semibold">{soles(b.amountCentimos)}</span>
          <span className="w-44 text-right text-xs text-emerald-400">
            {b.winRangeCentimos
              ? `gana entre ${soles(b.winRangeCentimos.min)} y ${soles(b.winRangeCentimos.max)}`
              : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function SalaPublica() {
  const { code } = useParams<{ code: string }>();
  const codeUp = useMemo(() => code?.toUpperCase() ?? "", [code]);
  const queryClient = useQueryClient();

  const room = useQuery({
    queryKey: ["room", codeUp],
    queryFn: () => getPublicRoom(codeUp),
    enabled: Boolean(codeUp),
  });
  const round = useQuery({
    queryKey: ["round", codeUp],
    queryFn: () => getPublicRound(codeUp),
    enabled: Boolean(codeUp),
    refetchInterval: 5000,
  });
  const bets = useQuery({
    queryKey: ["public-bets", codeUp],
    queryFn: () => getPublicBets(codeUp),
    enabled: Boolean(codeUp),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!codeUp) return;
    const socket = roomSocket(codeUp);
    const onUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ["round", codeUp] });
      queryClient.invalidateQueries({ queryKey: ["public-bets", codeUp] });
    };
    socket.on("round:update", onUpdate);
    return () => {
      socket.off("round:update", onUpdate);
    };
  }, [codeUp, queryClient]);

  const r = round.data?.data?.round;

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {room.data?.data?.room?.name ?? `Sala ${codeUp}`}
          </h1>
          <p className="text-xs text-neutral-500">Ruleta Rápida · demo con dinero ficticio</p>
        </div>
        {r && <Estado state={r.state} />}
      </header>

      {r?.state === "CUENTA_REGRESIVA" && r.countdownEndsAt && (
        <div className="mt-4 flex flex-col items-center">
          <Countdown endsAt={r.countdownEndsAt} />
          <p className="text-xs text-neutral-500">para cerrar la ronda</p>
        </div>
      )}

      {r && r.seq !== null && (
        <p className="mt-2 text-center text-xs text-neutral-500">
          Ronda #{r.seq} · seed comprometida publicada
        </p>
      )}

      <section className="mt-4">{r && <Roulette round={r} />}</section>

      <section className="mt-4 flex gap-3">
        {r && <PoolCard side="red" round={r} />}
        {r && <PoolCard side="blue" round={r} />}
      </section>

      <section className="mt-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Apuestas de la ronda
        </h2>
        <BetList bets={bets.data?.data?.bets ?? []} />
      </section>
    </main>
  );
}
