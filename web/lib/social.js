"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;
const KEY = "red_token";

export const KINDS = {
  note: { label: "Nota", icon: "📝", cta: "Aportar", hint: "Quien la lea puede aportar lo que quiera" },
  product: { label: "Producto", icon: "📦", cta: "Comprar", hint: "Producto físico con precio y stock" },
  service: { label: "Servicio", icon: "🛠️", cta: "Contratar", hint: "Un servicio que ofrecés por un precio" },
};

export const ORDER_STATUS = {
  pending: "Esperando pago",
  paid: "Pago confirmado · por entregar",
  fulfilled: "Completada",
  cancelled: "Cancelada",
};

export const getToken = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export async function sapi(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API}/social${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    let detail;
    try {
      detail = (await res.json()).detail;
    } catch {}
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join(". ");
    const err = new Error(typeof detail === "string" ? detail : `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

const Ctx = createContext(null);
export const useSocial = () => useContext(Ctx);

export function SocialProvider({ children }) {
  const [me, setMe] = useState(null);
  const [ready, setReady] = useState(false);
  const [interests, setInterests] = useState([]);

  useEffect(() => {
    sapi("/interests").then(setInterests).catch(() => {});
    if (!getToken()) return setReady(true);
    sapi("/me")
      .then(setMe)
      .catch(() => {
        try { localStorage.removeItem(KEY); } catch {}
      })
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback((auth) => {
    try { localStorage.setItem(KEY, auth.token); } catch {}
    setMe(auth.user);
  }, []);

  const signOut = useCallback(async () => {
    try { await sapi("/auth/logout", { method: "POST" }); } catch {}
    try { localStorage.removeItem(KEY); } catch {}
    setMe(null);
  }, []);

  return <Ctx.Provider value={{ me, setMe, ready, interests, signIn, signOut }}>{children}</Ctx.Provider>;
}
