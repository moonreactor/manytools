"use client";

import { useState } from "react";
import { KINDS, sapi, useSocial } from "../../lib/social";

export default function Composer({ onCreated, defaultInterest, post, onCancel }) {
  const { interests } = useSocial();
  const editing = !!post;
  const [kind, setKind] = useState(post?.kind || "note");
  const [f, setF] = useState(
    post
      ? {
          interest_id: String(post.interest_id),
          title: post.title,
          body: post.body,
          price: post.price ?? "",
          stock: post.stock ?? "",
          image_url: post.image_url,
          payment_url: post.payment_url,
        }
      : { interest_id: "", title: "", body: "", price: "", stock: "", image_url: "", payment_url: "" }
  );
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const interestId = f.interest_id || defaultInterest || "";
  const priced = kind !== "note";

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!interestId) return setErr("Elegí un interés");
    setBusy(true);
    try {
      const saved = await sapi(editing ? `/posts/${post.id}` : "/posts", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          kind,
          interest_id: Number(interestId),
          title: f.title,
          body: f.body,
          price: priced ? f.price || null : null,
          stock: kind === "product" && f.stock !== "" ? Number(f.stock) : null,
          image_url: f.image_url,
          payment_url: f.payment_url,
        }),
      });
      if (!editing) setF({ interest_id: f.interest_id, title: "", body: "", price: "", stock: "", image_url: "", payment_url: "" });
      onCreated(saved);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card composer" onSubmit={submit}>
      {editing && <strong style={{ display: "block", marginBottom: 8 }}>Editar {KINDS[kind].label.toLowerCase()}</strong>}
      {!editing && <div className="tabs-pill">
        {Object.entries(KINDS).map(([key, v]) => (
          <button type="button" key={key} className={kind === key ? "on" : ""} onClick={() => setKind(key)}>
            {v.icon} {v.label}
          </button>
        ))}
      </div>}
      {!editing && <p className="hint" style={{ margin: "0 0 10px" }}>{KINDS[kind].hint}</p>}
      <input className="field full" placeholder="Título" value={f.title} onChange={set("title")} maxLength={140} required />
      <textarea className="field full area" rows={3} placeholder="Contá más…" value={f.body} onChange={set("body")} maxLength={5000} />
      <div className="row">
        <select className="pill" value={interestId} onChange={set("interest_id")} required>
          <option value="">Interés…</option>
          {interests.map((i) => <option key={i.id} value={i.id}>{i.emoji} {i.name}</option>)}
        </select>
        {priced && (
          <input className="field" type="number" min="1" step="0.01" placeholder={kind === "service" ? "Precio desde (ARS)" : "Precio (ARS)"} value={f.price} onChange={set("price")} required />
        )}
        {kind === "product" && (
          <input className="field" type="number" min="0" placeholder="Stock (vacío = ilimitado)" value={f.stock} onChange={set("stock")} />
        )}
        <input className="field" type="url" placeholder="URL de imagen (opcional)" value={f.image_url} onChange={set("image_url")} />
      </div>
      <div className="row">
        <input className="field" type="url" placeholder="Link de pago de Mercado Pago (opcional, https://mpago.la/…)" value={f.payment_url} onChange={set("payment_url")} />
      </div>
      <p className="hint" style={{ margin: "6px 0 0" }}>
        {f.payment_url ? "Cobrás directo en tu cuenta de Mercado Pago; vos confirmás cuando llega el pago." : "Sin link, el pago es simulado (solo pruebas)."}
      </p>
      {err && <div className="error" style={{ margin: "10px 0 0" }}>{err}</div>}
      <div className="row end">
        {editing && <button type="button" className="pill" onClick={onCancel}>Cancelar</button>}
        <button className="pill solid" disabled={busy || !f.title.trim()}>{busy ? "Guardando…" : editing ? "Guardar cambios" : "Publicar"}</button>
      </div>
    </form>
  );
}
