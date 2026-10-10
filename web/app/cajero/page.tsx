"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useQuery } from "@tanstack/react-query";

import { getMe } from "@/lib/api";
import { clearSession, getStoredUser, getToken } from "@/lib/auth";

export default function CajeroPage() {
  const router = useRouter();
  const token = getToken();

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

  const stored = getStoredUser();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-2 text-3xl font-bold">Panel de cajero</h1>
      {stored && (
        <p className="text-neutral-400">
          {stored.name} · {stored.username} · rol {stored.role}
        </p>
      )}
      <p className="mt-6 text-sm text-neutral-500">
        El registro de apuestas llega con la spec 007.
      </p>
    </main>
  );
}
