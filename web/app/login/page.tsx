"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { loginAdmin, loginCashier } from "@/lib/api";
import { saveSession } from "@/lib/auth";

function field(value: string, set: (v: string) => void, props: object) {
  return (
    <input
      className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
      value={value}
      onChange={(e) => set(e.target.value)}
      required
      {...props}
    />
  );
}

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [cashierUser, setCashierUser] = useState("");
  const [cashierPin, setCashierPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(kind: "admin" | "cashier") {
    setError(null);
    setLoading(true);
    try {
      const res =
        kind === "admin"
          ? await loginAdmin(adminUser, adminPass)
          : await loginCashier(cashierUser, cashierPin);
      if (res.status !== 200) {
        setError("Credenciales inválidas");
        return;
      }
      saveSession(res.data.token, res.data.user);
      // Descarta respuestas cacheadas de sesiones anteriores (p. ej. un 401
      // de /auth/me) para que no invaliden el token recién guardado.
      queryClient.clear();
      router.push(res.data.user.role === "admin" ? "/admin" : "/cajero");
    } catch {
      setError("No se pudo contactar la API");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center gap-8 p-8">
      <section className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="mb-4 text-xl font-bold">Administrador</h2>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("admin");
          }}
        >
          {field(adminUser, setAdminUser, { placeholder: "Usuario" })}
          {field(adminPass, setAdminPass, {
            placeholder: "Contraseña",
            type: "password",
          })}
          <button
            className="rounded bg-blue-600 py-2 font-semibold disabled:opacity-50"
            disabled={loading}
          >
            Entrar
          </button>
        </form>
      </section>

      <section className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="mb-4 text-xl font-bold">Cajero</h2>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit("cashier");
          }}
        >
          {field(cashierUser, setCashierUser, { placeholder: "Usuario" })}
          {field(cashierPin, setCashierPin, {
            placeholder: "PIN (4–6 dígitos)",
            type: "password",
            inputMode: "numeric",
          })}
          <button
            className="rounded bg-red-600 py-2 font-semibold disabled:opacity-50"
            disabled={loading}
          >
            Entrar
          </button>
        </form>
      </section>

      {error && (
        <p className="fixed bottom-6 rounded bg-red-900/80 px-4 py-2 text-sm">
          {error}
        </p>
      )}
    </main>
  );
}
