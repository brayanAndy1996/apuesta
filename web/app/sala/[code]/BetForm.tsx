"use client";

import { useMemo, useState } from "react";

import QRCode from "qrcode";

import { getBetMessage, type PublicRoom } from "@/lib/api";

const soles = (centimos: number) => `S/ ${(centimos / 100).toFixed(2)}`;

type Method = "yape" | "plin";

function QrImage({ payload }: { payload: string }) {
  // El valor guardado puede ser una URL de imagen o un payload de QR.
  const cells = useMemo(() => {
    if (/^https?:\/\//.test(payload)) return null;
    try {
      const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
      const size = qr.modules.size;
      const rects: string[] = [];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (qr.modules.get(r, c)) rects.push(`M${c} ${r}h1v1h-1z`);
        }
      }
      return { size, path: rects.join("") };
    } catch {
      return null;
    }
  }, [payload]);

  if (/^https?:\/\//.test(payload)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={payload} alt="QR de pago" className="rounded bg-white p-2" width={220} height={220} />;
  }
  if (!cells) return <p className="text-xs text-neutral-500">QR no disponible</p>;
  return (
    <svg
      className="rounded bg-white p-2"
      width={220}
      height={220}
      viewBox={`-1 -1 ${cells.size + 2} ${cells.size + 2}`}
      role="img"
      aria-label="QR de pago"
    >
      <rect x={-1} y={-1} width={cells.size + 2} height={cells.size + 2} fill="white" />
      <path d={cells.path} fill="black" />
    </svg>
  );
}

// R18: el jugador arma su apuesta y envía el mensaje ya escrito por WhatsApp.
export function BetForm({ code, room }: { code: string; room: PublicRoom }) {
  const [playerName, setPlayerName] = useState("");
  const [phone, setPhone] = useState("");
  const [side, setSide] = useState<"red" | "blue">("red");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("yape");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const amountCentimos = Math.round(Number(amount.replace(",", ".")) * 100);
  const amountOk =
    Number.isFinite(amountCentimos) &&
    amountCentimos >= room.minBetCentimos &&
    amountCentimos <= room.maxBetCentimos;
  const valid =
    playerName.trim().length > 0 && phone.replace(/\D/g, "").length >= 6 && amountOk;

  const qrPayload = method === "yape" ? room.yapeQr : room.plinQr;

  async function sendWhatsApp() {
    if (!valid) return;
    setSending(true);
    setError(null);
    const res = await getBetMessage(code, {
      side,
      amountCentimos,
      playerName: playerName.trim(),
      phone: phone.trim(),
    });
    setSending(false);
    if (res.status !== 200) {
      setError("No se pudo generar el mensaje");
      return;
    }
    window.open(res.data.whatsappUrl, "_blank", "noopener");
  }

  const input =
    "w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500";

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Arma tu apuesta
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className={input}
          placeholder="Nombre y apellido"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
        />
        <input
          className={input}
          placeholder="Teléfono (9xx xxx xxx)"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <div className="flex gap-2">
          {(["red", "blue"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setSide(c)}
              className={`flex-1 rounded border px-3 py-2 text-sm font-semibold ${
                side === c
                  ? c === "red"
                    ? "border-red-500 bg-red-950 text-red-300"
                    : "border-blue-500 bg-blue-950 text-blue-300"
                  : "border-neutral-700 text-neutral-400"
              }`}
            >
              {c === "red" ? "Rojo" : "Azul"}
            </button>
          ))}
        </div>
        <input
          className={input}
          placeholder={`Monto S/ (${soles(room.minBetCentimos)}–${soles(room.maxBetCentimos)})`}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      {amount && !amountOk && (
        <p className="mt-1 text-xs text-amber-400">
          El monto debe estar entre {soles(room.minBetCentimos)} y {soles(room.maxBetCentimos)}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        {(["yape", "plin"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`flex-1 rounded border px-3 py-2 text-sm font-semibold capitalize ${
              method === m ? "border-purple-500 bg-purple-950 text-purple-300" : "border-neutral-700 text-neutral-400"
            }`}
          >
            {m === "yape" ? "Yape" : "Plin"}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="shrink-0">
          {qrPayload ? (
            <QrImage payload={qrPayload} />
          ) : (
            <p className="w-56 rounded border border-dashed border-neutral-700 p-4 text-center text-xs text-neutral-500">
              La sala aún no configuró el QR de {method === "yape" ? "Yape" : "Plin"}
            </p>
          )}
        </div>
        <div className="flex-1 text-sm text-neutral-400">
          <p>
            1. Paga con {method === "yape" ? "Yape" : "Plin"} escaneando el QR. <br />
            2. Toca el botón y envía el mensaje ya escrito por WhatsApp. <br />
            3. El cajero confirma tu pago y tu apuesta aparece en la lista.
          </p>
          <button
            type="button"
            disabled={!valid || sending}
            onClick={sendWhatsApp}
            className="mt-3 w-full rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-40"
          >
            {sending ? "Abriendo…" : "Enviar por WhatsApp"}
          </button>
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    </section>
  );
}
