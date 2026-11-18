"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sapi, useSocial } from "../../../lib/social";

export default function Login() {
  const { signIn, interests } = useSocial();
  const router = useRouter();
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ username: "", display_name: "", password: "" });
  const [picked, setPicked] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const body = mode === "login" ? { username: f.username, password: f.password } : { ...f, interest_ids: picked };
      signIn(await sapi(`/auth/${mode === "login" ? "login" : "register"}`, { method: "POST", body: JSON.stringify(body) }));
      router.push("/red");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card auth" onSubmit={submit}>
      <div className="tabs-pill">
        <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>Ingresar</button>
        <button type="button" className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>Crear cuenta</button>
      </div>
      <input className="field full" placeholder="Usuario" value={f.username} onChange={set("username")} autoCapitalize="none" required />
      {mode === "register" && <input className="field full" placeholder="Tu nombre" value={f.display_name} onChange={set("display_name")} required />}
      <input className="field full" type="password" placeholder={mode === "register" ? "Contraseña (mín. 8)" : "Contraseña"} value={f.password} onChange={set("password")} minLength={mode === "register" ? 8 : 1} required />
      {mode === "register" && (
        <>
          <p className="hint">¿Qué te interesa? Armamos tu feed con esto.</p>
          <div className="filters" style={{ margin: 0 }}>
            {interests.map((i) => (
              <button type="button" key={i.id} className={`pill ${picked.includes(i.id) ? "on" : ""}`} onClick={() => toggle(i.id)}>
                {i.emoji} {i.name}
              </button>
            ))}
          </div>
        </>
      )}
      {err && <div className="error">{err}</div>}
      <button className="cta" disabled={busy}>{mode === "login" ? "Ingresar" : "Crear cuenta"}</button>
    </form>
  );
}
