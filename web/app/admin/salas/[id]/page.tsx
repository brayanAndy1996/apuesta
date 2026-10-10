"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getRoom,
  listCashiers,
  replaceSlots,
  updateRoom,
  type RoomSlot,
} from "@/lib/api";
import { clearSession, getToken } from "@/lib/auth";

const toSoles = (centimos: number) => (centimos / 100).toFixed(2);

export default function SalaDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = getToken();

  const roomQuery = useQuery({
    queryKey: ["room", id],
    queryFn: () => getRoom(token ?? "", id),
    enabled: Boolean(token),
  });
  const cashiersQuery = useQuery({
    queryKey: ["cashiers"],
    queryFn: () => listCashiers(token ?? ""),
    enabled: Boolean(token),
  });

  const room = roomQuery.data?.data?.room;
  const [form, setForm] = useState({
    name: "",
    whatsappNumber: "",
    minBet: "1.00",
    maxBet: "50.00",
    cashierId: "",
  });
  const [slots, setSlots] = useState<RoomSlot[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadedRoomId, setLoadedRoomId] = useState<string | null>(null);

  useEffect(() => {
    if (!token || roomQuery.data?.status === 401) {
      clearSession();
      router.replace("/login");
    }
  }, [token, roomQuery.data, router]);

  if (room && room.id !== loadedRoomId) {
    setLoadedRoomId(room.id);
    setForm({
      name: room.name,
      whatsappNumber: room.whatsappNumber ?? "",
      minBet: toSoles(room.minBetCentimos),
      maxBet: toSoles(room.maxBetCentimos),
      cashierId: room.cashier?.id ?? "",
    });
    setSlots(room.slots ?? []);
  }

  const save = useMutation({
    mutationFn: () =>
      updateRoom(token ?? "", id, {
        name: form.name,
        whatsappNumber: form.whatsappNumber || null,
        minBetCentimos: Math.round(Number(form.minBet) * 100),
        maxBetCentimos: Math.round(Number(form.maxBet) * 100),
        cashierId: form.cashierId || null,
      }),
    onSuccess: (res) => {
      setMsg(res.status === 200 ? "Guardado" : (res.data as { error?: string }).error ?? "error");
      queryClient.invalidateQueries({ queryKey: ["room", id] });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
    },
  });

  const toggle = useMutation({
    mutationFn: () => updateRoom(token ?? "", id, { active: !room?.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["room", id] }),
  });

  const saveSlots = useMutation({
    mutationFn: () => replaceSlots(token ?? "", id, slots),
    onSuccess: (res) => {
      setMsg(res.status === 200 ? "Casillas guardadas" : (res.data as { error?: string }).error ?? "error");
      queryClient.invalidateQueries({ queryKey: ["room", id] });
    },
  });

  if (!room) return <main className="p-8 text-neutral-400">Cargando…</main>;

  const cashiers = cashiersQuery.data?.data?.cashiers ?? [];
  const others = cashiers.filter(
    (c) => c.active && (!room.cashier || c.id !== room.cashier.id),
  );
  const weightTotal = slots.reduce((acc, s) => acc + Number(s.weight || 0), 0);
  const isGeneral = room.code === "GENERAL";

  const setSlot = (i: number, patch: Partial<RoomSlot>) =>
    setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {room.name}{" "}
          <span className="font-mono text-sm text-neutral-500">{room.code}</span>
        </h1>
        <Link href="/admin/salas" className="text-sm text-neutral-400 underline">
          ← Salas
        </Link>
      </div>

      <section className="mt-6 space-y-3 rounded-lg border border-neutral-700 p-4">
        <label className="block text-sm">
          Nombre
          <input
            value={form.name}
            disabled={isGeneral}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1 w-full rounded border border-neutral-600 bg-transparent px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          WhatsApp de pagos (E.164, opcional)
          <input
            value={form.whatsappNumber}
            placeholder="+51 999 999 999"
            onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
            className="mt-1 w-full rounded border border-neutral-600 bg-transparent px-3 py-2"
          />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1 text-sm">
            Apuesta mínima (S/)
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.minBet}
              onChange={(e) => setForm({ ...form, minBet: e.target.value })}
              className="mt-1 w-full rounded border border-neutral-600 bg-transparent px-3 py-2"
            />
          </label>
          <label className="block flex-1 text-sm">
            Apuesta máxima (S/)
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.maxBet}
              onChange={(e) => setForm({ ...form, maxBet: e.target.value })}
              className="mt-1 w-full rounded border border-neutral-600 bg-transparent px-3 py-2"
            />
          </label>
        </div>
        <label className="block text-sm">
          Cajero asignado
          <select
            value={form.cashierId}
            onChange={(e) => setForm({ ...form, cashierId: e.target.value })}
            className="mt-1 w-full rounded border border-neutral-600 bg-transparent px-3 py-2"
          >
            <option value="">Sin cajero</option>
            {room.cashier && (
              <option value={room.cashier.id}>{room.cashier.name}</option>
            )}
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (@{c.username})
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            Guardar cambios
          </button>
          <button
            onClick={() => toggle.mutate()}
            disabled={isGeneral}
            className="rounded border border-neutral-600 px-4 py-2 disabled:opacity-40"
          >
            {room.active ? "Desactivar" : "Activar"}
          </button>
          {isGeneral && (
            <span className="text-xs text-neutral-500">
              La sala general no se puede desactivar ni renombrar
            </span>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-neutral-700 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Casillas</h2>
          <span
            className={`text-sm ${weightTotal === 100 ? "text-green-500" : "text-red-500"}`}
          >
            Pesos: {weightTotal} %
          </span>
        </div>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-1">Color</th>
              <th>Multiplicador</th>
              <th>Peso %</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {slots.map((s, i) => (
              <tr key={i} className="border-t border-neutral-800">
                <td className="py-1">
                  <select
                    value={s.side}
                    onChange={(e) =>
                      setSlot(i, { side: e.target.value as "red" | "blue" })
                    }
                    className="rounded border border-neutral-600 bg-transparent px-2 py-1"
                  >
                    <option value="red">rojo</option>
                    <option value="blue">azul</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="1.01"
                    max="1.99"
                    value={(s.multiplier / 100).toFixed(2)}
                    onChange={(e) =>
                      setSlot(i, { multiplier: Math.round(Number(e.target.value) * 100) })
                    }
                    className="w-20 rounded border border-neutral-600 bg-transparent px-2 py-1"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={s.weight}
                    onChange={(e) => setSlot(i, { weight: Number(e.target.value) })}
                    className="w-16 rounded border border-neutral-600 bg-transparent px-2 py-1"
                  />
                </td>
                <td className="text-right">
                  <button
                    onClick={() => setSlots((p) => p.filter((_, j) => j !== i))}
                    className="text-red-500"
                  >
                    quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex gap-3">
          <button
            onClick={() => setSlots((p) => [...p, { side: "red", multiplier: 150, weight: 1 }])}
            className="rounded border border-neutral-600 px-3 py-1 text-sm"
          >
            + casilla
          </button>
          <button
            onClick={() => saveSlots.mutate()}
            disabled={saveSlots.isPending || weightTotal !== 100}
            className="rounded bg-blue-600 px-4 py-1 text-white disabled:opacity-50"
          >
            Guardar casillas
          </button>
        </div>
      </section>

      {msg && <p className="mt-4 text-sm text-neutral-300">{msg}</p>}
    </main>
  );
}
