"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { useQuery } from "@tanstack/react-query";

import {
  getPublicRoom,
  getStats,
  listRoundHistory,
  type HistoryRound,
  type SlotStats,
} from "@/lib/api";
import { drawSlot, sha256Hex } from "@/lib/verify";

const soles = (centimos: number) => `S/ ${(centimos / 100).toFixed(2)}`;
const mult = (m: number) => `${(m / 100).toFixed(2)}`;
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);
const hora = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Lima",
  });

const COLOR = { red: "Rojo", blue: "Azul" } as const;
const CHIP = {
  red: "bg-red-900/60 text-red-300",
  blue: "bg-sky-900/60 text-sky-300",
} as const;

const PASOS = [
  {
    titulo: "1. Arma tu apuesta",
    texto:
      "Elige rojo o azul y tu monto. La ruleta tiene casillas con multiplicadores distintos por color: tu premio es tu apuesta × el multiplicador de la casilla ganadora.",
  },
  {
    titulo: "2. Paga por Yape o Plin",
    texto:
      "Escanea el QR y paga. Envía el mensaje ya escrito por WhatsApp para que el cajero registre tu apuesta.",
  },
  {
    titulo: "3. Espera la ronda",
    texto:
      "Cuando la bolsa está completa arranca la cuenta regresiva. Si falta dinero del otro color, tu apuesta espera en cola para la siguiente ronda.",
  },
  {
    titulo: "4. Sorteo verificable",
    texto:
      "El resultado sale de una semilla cuyo hash se publica ANTES de girar. Al liquidar se revela la semilla: cualquiera puede recomputar el resultado en el verificador de abajo.",
  },
];

const FAQ = [
  {
    q: "¿Con qué dinero se juega?",
    a: "Dinero ficticio — esto es un demo. Los pagos por Yape/Plin y los premios son simulados para probar el sistema.",
  },
  {
    q: "¿Cómo sé que el sorteo no está arreglado?",
    a: "Antes de cada giro publicamos el hash SHA-256 de la semilla. Al terminar la ronda revelamos la semilla: con ella puedes verificar el hash y recomputar la casilla ganadora (posición = semilla % 100). Si la casa hubiera cambiado la semilla después de ver las apuestas, el hash no coincidiría.",
  },
  {
    q: "¿Por qué mi apuesta quedó 'en espera'?",
    a: "La casa nunca arriesga más de lo que hay en la bolsa. Si tu apuesta no cabe con seguridad, espera en cola (en orden de llegada) hasta que entre dinero del otro color o hasta la siguiente ronda.",
  },
  {
    q: "¿Cuánto puedo ganar?",
    a: "Tu apuesta × el multiplicador de la casilla que salga de tu color. Los multiplicadores y su probabilidad (peso) están en la tabla de casillas — los multiplicadores altos salen menos.",
  },
  {
    q: "¿Cómo cobro?",
    a: "El cajero paga a los ganadores por el mismo Yape/Plin con el que apostaste, al terminar la ronda.",
  },
];

function Calculadora({ slots }: { slots: SlotStats[] }) {
  const [monto, setMonto] = useState("10");
  const [side, setSide] = useState<"red" | "blue">("red");
  const centimos = Math.round(Number(monto) * 100);
  const range = useMemo(() => {
    if (!Number.isFinite(centimos) || centimos <= 0) return null;
    const ms = slots.filter((s) => s.side === side).map((s) => s.multiplier);
    if (!ms.length) return null;
    return {
      min: Math.floor((centimos * Math.min(...ms)) / 100),
      max: Math.floor((centimos * Math.max(...ms)) / 100),
    };
  }, [centimos, side, slots]);

  return (
    <div className="rounded-lg border border-neutral-800 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Calculadora de ganancias
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Monto S/
          <input
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            inputMode="decimal"
            className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5"
          />
        </label>
        <div className="flex gap-2">
          {(["red", "blue"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`rounded px-3 py-1.5 text-sm ${CHIP[s]} ${
                side === s ? "ring-2 ring-white/40" : "opacity-50"
              }`}
            >
              {COLOR[s]}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 text-lg">
        {range
          ? `Ganas entre ${soles(range.min)} y ${soles(range.max)}`
          : "Ingresa un monto válido"}
      </p>
      <p className="text-xs text-neutral-500">
        El premio exacto depende de la casilla que salga; todos los cálculos se
        redondean hacia abajo al céntimo.
      </p>
    </div>
  );
}

function Casillas({ slots }: { slots: SlotStats[] }) {
  const orden = (side: "red" | "blue") =>
    slots.filter((s) => s.side === side).sort((a, b) => a.multiplier - b.multiplier);
  return (
    <div className="rounded-lg border border-neutral-800 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Casillas y probabilidades
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["red", "blue"] as const).map((side) => (
          <table key={side} className="w-full text-sm">
            <thead>
              <tr className={`text-left ${side === "red" ? "text-red-300" : "text-sky-300"}`}>
                <th className="pb-1">{COLOR[side]}</th>
                <th className="pb-1 text-right">Paga</th>
                <th className="pb-1 text-right">Probabilidad</th>
              </tr>
            </thead>
            <tbody>
              {orden(side).map((s) => (
                <tr key={s.id} className="border-t border-neutral-800">
                  <td className="py-1">×{mult(s.multiplier)}</td>
                  <td className="py-1 text-right">tu apuesta × {mult(s.multiplier)}</td>
                  <td className="py-1 text-right">{s.weight}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-semibold ${
        ok ? "bg-emerald-900/60 text-emerald-300" : "bg-red-900/60 text-red-300"
      }`}
    >
      {children}
    </span>
  );
}

function Verificador({
  rounds,
  slots,
}: {
  rounds: HistoryRound[];
  slots: SlotStats[];
}) {
  const liquidadas = rounds.filter((r) => r.state === "LIQUIDADA" && r.seed);
  const [seq, setSeq] = useState<number | null>(null);
  const [check, setCheck] = useState<{
    hashOk: boolean;
    pos: number;
    slotOk: boolean;
    recomputed: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const round = liquidadas.find((r) => r.seq === seq) ?? liquidadas[0];

  async function verificar(r: HistoryRound) {
    if (!r.seed) return;
    setBusy(true);
    setSeq(r.seq);
    const recomputed = await sha256Hex(r.seed);
    const d = drawSlot(r.seed, slots);
    setCheck({
      hashOk: recomputed === r.seedHash,
      pos: d?.pos ?? -1,
      slotOk: d?.slot.id === r.result?.id,
      recomputed,
    });
    setBusy(false);
  }

  return (
    <div className="rounded-lg border border-neutral-800 p-4">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Verificador de rondas
      </h2>
      <p className="mb-3 text-xs text-neutral-500">
        Elige una ronda liquidada: recomputamos el hash de la semilla y la
        casilla ganadora en tu navegador, sin tocar el servidor.
      </p>
      {liquidadas.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Todavía no hay rondas liquidadas para verificar.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={round?.seq ?? ""}
            onChange={(e) => {
              const r = liquidadas.find((x) => x.seq === Number(e.target.value));
              if (r) void verificar(r);
            }}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
          >
            {liquidadas.map((r) => (
              <option key={r.seq} value={r.seq}>
                Ronda #{r.seq}
              </option>
            ))}
          </select>
          <button
            onClick={() => round && void verificar(round)}
            disabled={busy}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
          >
            Verificar
          </button>
        </div>
      )}
      {check && round && (
        <div className="mt-3 space-y-1 text-sm">
          <p className="flex items-center gap-2">
            Hash publicado antes del giro:
            <Badge ok={check.hashOk}>
              {check.hashOk ? "coincide ✓" : "NO coincide ✗"}
            </Badge>
          </p>
          <p className="break-all font-mono text-xs text-neutral-500">
            seed: {round.seed}
          </p>
          <p className="flex items-center gap-2">
            Posición = seed % 100 → <b>{check.pos}</b> → casilla recomputada:
            <Badge ok={check.slotOk}>
              {check.slotOk
                ? `×${mult(round.result!.multiplier)} ${COLOR[round.result!.side]} ✓`
                : "distinta al resultado oficial ✗"}
            </Badge>
          </p>
        </div>
      )}
    </div>
  );
}

export default function ReglasPage() {
  const params = useParams<{ code: string }>();
  const codeUp = (params.code ?? "").toUpperCase();

  const room = useQuery({
    queryKey: ["room", codeUp],
    queryFn: () => getPublicRoom(codeUp),
    enabled: !!codeUp,
  });
  const history = useQuery({
    queryKey: ["rounds", codeUp],
    queryFn: () => listRoundHistory(codeUp),
    enabled: !!codeUp,
  });
  const stats = useQuery({
    queryKey: ["stats", codeUp],
    queryFn: () => getStats(codeUp),
    enabled: !!codeUp,
  });

  const slots = stats.data?.data?.slots ?? [];
  const rounds = history.data?.data?.rounds ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reglas y confianza</h1>
          <p className="text-xs text-neutral-500">
            {room.data?.data?.room?.name ?? `Sala ${codeUp}`} · Ruleta Rápida · demo
            con dinero ficticio
          </p>
        </div>
        <Link
          href={`/sala/${codeUp}`}
          className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          ← Volver a la sala
        </Link>
      </header>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          ¿Cómo funciona?
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {PASOS.map((p) => (
            <div key={p.titulo} className="rounded-lg border border-neutral-800 p-4">
              <h3 className="mb-1 font-semibold">{p.titulo}</h3>
              <p className="text-sm text-neutral-400">{p.texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        {slots.length > 0 && <Calculadora slots={slots} />}
      </section>

      <section className="mt-6">{slots.length > 0 && <Casillas slots={slots} />}</section>

      <section className="mt-6 rounded-lg border border-neutral-800 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Historial y estadísticas ({stats.data?.data?.rounds ?? 0} rondas liquidadas)
        </h2>
        {stats.data?.data && stats.data.data.rounds > 0 && (
          <div className="mb-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-400">
                  <th className="pb-1">Casilla</th>
                  <th className="pb-1 text-right">Esperado</th>
                  <th className="pb-1 text-right">Real</th>
                </tr>
              </thead>
              <tbody>
                {stats.data.data.slots.map((s) => (
                  <tr key={s.id} className="border-t border-neutral-800">
                    <td className="py-1">
                      <span className={`mr-1 rounded px-1.5 py-0.5 text-xs ${CHIP[s.side]}`}>
                        {COLOR[s.side]}
                      </span>
                      ×{mult(s.multiplier)}
                    </td>
                    <td className="py-1 text-right">{pct(s.expectedPct)}</td>
                    <td className="py-1 text-right">
                      {pct(s.realPct)} ({s.realCount})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-400">
                <th className="pb-1">Ronda</th>
                <th className="pb-1">Resultado</th>
                <th className="pb-1 text-right">Hora</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.seq} className="border-t border-neutral-800">
                  <td className="py-1">#{r.seq}</td>
                  <td className="py-1">
                    {r.result ? (
                      <span className={`rounded px-1.5 py-0.5 text-xs ${CHIP[r.result.side]}`}>
                        {COLOR[r.result.side]} ×{mult(r.result.multiplier)}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-500">{r.state}</span>
                    )}
                  </td>
                  <td className="py-1 text-right text-neutral-500">{hora(r.createdAt)}</td>
                </tr>
              ))}
              {rounds.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-2 text-neutral-500">
                    Aún no hay rondas en esta sala.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <Verificador rounds={rounds} slots={slots} />
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Preguntas frecuentes
        </h2>
        <div className="space-y-2">
          {FAQ.map((f) => (
            <details key={f.q} className="rounded-lg border border-neutral-800 p-4">
              <summary className="cursor-pointer font-semibold">{f.q}</summary>
              <p className="mt-2 text-sm text-neutral-400">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
