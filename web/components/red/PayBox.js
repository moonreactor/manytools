"use client";

import Link from "next/link";
import { useState } from "react";
import { money } from "../Money";
import { KINDS, sapi, useSocial } from "../../lib/social";

const TIPS = [500, 1000, 2500, 5000];

export default function PayBox({ post, onPaid }) {
  const { me } = useSocial();
  const [amount, setAmount] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const k = KINDS[post.kind];

  if (!me)
    return (
      <div className="card paybox" id="pagar">
        <p>Ingresá para {k.cta.toLowerCase()}.</p>
        <Link className="pill solid" href="/red/login">Ingresar</Link>
      </div>
    );
  if (me.id === post.author_id)
    return <div className="card paybox muted" id="pagar">Es tu publicación. Las órdenes aparecen en “Compras y ventas”.</div>;
  const mp = post.payment_url;
  if (mp && post.kind === "note")
    return (
      <div className="card paybox" id="pagar">
        <h3>{k.icon} {k.cta}</h3>
        <p className="muted small">Si te sirvió, agradecé con un aporte por Mercado Pago.</p>
        <a className="cta mp" href={mp} target="_blank" rel="noopener noreferrer">Aportar con Mercado Pago</a>
      </div>
    );
  if (done && done.status === "pending")
    return (
      <div className="card paybox" id="pagar">
        <strong>🧾 Pedido registrado</strong>
        <p className="muted small">Falta pagar: abrí Mercado Pago, completá el pago y el vendedor confirmará la orden.</p>
        <a className="cta mp" href={mp} target="_blank" rel="noopener noreferrer">Pagar {money(done.amount)} con Mercado Pago</a>
        <Link className="link" href="/red/ordenes">Ver mis compras</Link>
      </div>
    );
  if (done)
    return (
      <div className="card paybox" id="pagar">
        <strong>✅ ¡Listo!</strong>
        <p className="muted">
          {post.kind === "note" ? "Tu aporte fue enviado." : "Tu pedido quedó registrado; el vendedor lo verá en sus órdenes."}{" "}
          Total {money(done.amount)}.
        </p>
        <Link className="link" href="/red/ordenes">Ver mis compras</Link>
      </div>
    );

  const unit = post.kind === "note" ? Number(amount) || 0 : post.price * (post.kind === "product" ? qty : 1);
  const soldOut = post.kind === "product" && post.stock === 0;

  async function pay(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const body = { note };
      if (post.kind === "note") body.amount = amount;
      if (post.kind === "product") body.quantity = qty;
      const order = await sapi(`/posts/${post.id}/pay`, { method: "POST", body: JSON.stringify(body) });
      setDone(order);
      onPaid?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card paybox" id="pagar" onSubmit={pay}>
      <h3>{k.icon} {k.cta}</h3>
      {post.kind === "note" && (
        <>
          <p className="muted small">Si te sirvió, agradecé con un aporte. Elegís cuánto.</p>
          <div className="people">
            {TIPS.map((t) => (
              <button type="button" key={t} className={`pill ${Number(amount) === t ? "on" : ""}`} onClick={() => setAmount(String(t))}>{money(t)}</button>
            ))}
          </div>
          <input className="field full" type="number" min="1" step="0.01" placeholder="Otro monto (ARS)" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </>
      )}
      {post.kind === "product" && (
        <>
          <label className="small muted">Cantidad
            <input className="field full" type="number" min="1" max={post.stock ?? 1000} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <textarea className="field full area" rows={2} placeholder="Dirección de entrega" value={note} onChange={(e) => setNote(e.target.value)} required />
        </>
      )}
      {post.kind === "service" && (
        <textarea className="field full area" rows={3} placeholder="Contale al vendedor qué necesitás" value={note} onChange={(e) => setNote(e.target.value)} required />
      )}
      {post.kind === "note" && (
        <input className="field full" placeholder="Mensaje (opcional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      )}
      {err && <div className="error">{err}</div>}
      <button className="cta" disabled={busy || soldOut || unit <= 0}>
        {soldOut ? "Sin stock" : busy ? "Procesando…" : `${k.cta} · ${money(unit)}`}
      </button>
      <p className="hint">{mp ? "Después de pedir, te llevamos a Mercado Pago para pagar." : "Pago simulado: todavía no se mueve dinero real."}</p>
    </form>
  );
}
