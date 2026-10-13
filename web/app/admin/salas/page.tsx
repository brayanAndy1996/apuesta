"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createRoom, listCashiers, listRooms } from "@/lib/api";
import { clearSession, getToken } from "@/lib/auth";

export default function SalasPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = getToken();
  const [name, setName] = useState("");
  const [cashierId, setCashierId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const roomsQuery = useQuery({
    queryKey: ["rooms"],
    queryFn: () => listRooms(token ?? ""),
    enabled: Boolean(token),
  });
  const cashiersQuery = useQuery({
    queryKey: ["cashiers"],
    queryFn: () => listCashiers(token ?? ""),
    enabled: Boolean(token),
  });

  useEffect(() => {
    if (!token || roomsQuery.data?.status === 401 || roomsQuery.data?.status === 403) {
      clearSession();
      router.replace("/login");
    }
  }, [token, roomsQuery.data, router]);

  const create = useMutation({
    mutationFn: (body: unknown) => createRoom(token ?? "", body),
    onSuccess: (res) => {
      if (res.status === 201) {
        setName("");
        setCashierId("");
        setError(null);
        queryClient.invalidateQueries({ queryKey: ["rooms"] });
      } else {
        setError((res.data as { error?: string }).error ?? "error al crear");
      }
    },
  });

  const rooms = roomsQuery.data?.data?.rooms ?? [];
  const cashiers = cashiersQuery.data?.data?.cashiers ?? [];
  const assigned = new Set(rooms.map((r) => r.cashier?.id).filter(Boolean));
  const freeCashiers = cashiers.filter((c) => c.active && !assigned.has(c.id));

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Salas</h1>
        <Link href="/admin" className="text-sm text-neutral-400 underline">
          ← Panel
        </Link>
      </div>

      <form
        className="mt-6 flex flex-wrap gap-2 rounded-lg border border-neutral-700 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name, ...(cashierId ? { cashierId } : {}) });
        }}
      >
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la sala"
          className="flex-1 rounded border border-neutral-600 bg-transparent px-3 py-2"
        />
        <select
          value={cashierId}
          onChange={(e) => setCashierId(e.target.value)}
          className="rounded border border-neutral-600 bg-transparent px-3 py-2"
        >
          <option value="">Sin cajero</option>
          {freeCashiers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (@{c.username})
            </option>
          ))}
        </select>
        <button
          disabled={create.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          Crear sala
        </button>
        {error && <p className="w-full text-sm text-red-500">{error}</p>}
      </form>

      <ul className="mt-6 divide-y divide-neutral-800 rounded-lg border border-neutral-700">
        {rooms.map((room) => (
          <li key={room.id}>
            <Link
              href={`/admin/salas/${room.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-neutral-900"
            >
              <div>
                <span className="font-medium">{room.name}</span>
                <span className="ml-2 font-mono text-xs text-neutral-500">
                  {room.code}
                </span>
              </div>
              <div className="text-right text-sm text-neutral-400">
                <div>
                  {room.cashier ? `Cajero: ${room.cashier.name}` : "Sin cajero"}
                </div>
                <div className={room.active ? "text-green-500" : "text-red-500"}>
                  {room.active ? "activa" : "inactiva"}
                </div>
              </div>
            </Link>
          </li>
        ))}
        {rooms.length === 0 && (
          <li className="px-4 py-6 text-center text-neutral-500">
            No hay salas todavía
          </li>
        )}
      </ul>
    </main>
  );
}
