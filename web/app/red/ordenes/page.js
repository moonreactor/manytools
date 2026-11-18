"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { money } from "../../../components/Money";
import { timeAgo } from "../../../lib/format";
import { KINDS, ORDER_STATUS, sapi, useSocial } from "../../../lib/social";

export default function Orders() {
  const { me, ready } = useSocial();
  const [role, setRole] = useState("buyer");
  const [orders, setOrders] = useState(null);
  const [earn, setEarn] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    sapi(`/orders?role=${role}`).then(setOrders).catch((e) => setErr(e.message));
    sapi("/me/earnings").then(setEarn).catch(() => {});
  }, [role]);
  useEffect(() => { if (me) { setOrders(null); load(); } }, [me, load]);

  async function setStatus(id, status) {
    if (status === "cancelled" && !confirm("¿Cancelar la orden? Si ya cobraste, el reintegro lo hacés desde Mercado Pago.")) return;
    try {
      await sapi(`/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  if (ready && !me) return <p className="empty"><Link className="link" href="/red/login">Ingresá</Link> para ver tus órdenes.</p>;
  const seller = role === "seller";
  return (
    <>
      <header className="page-head"><h1 className="title">Compras y ventas</h1></header>
      {earn && (
        <div className="metrics">
          <div className="metric"><span className="muted">Cobrado (bruto)</span><strong>{money(earn.gross)}</strong></div>
          <div className="metric"><span className="muted">Comisión ({earn.fee_pct}%)</span><strong>{money(earn.fee)}</strong></div>
          <div className="metric"><span className="muted">Neto para vos</span><strong className="pos">{money(earn.net)}</strong></div>
          <div className="metric"><span className="muted">Pendiente de entregar</span><strong>{money(earn.pending)}</strong></div>
        </div>
      )}
      <div className="tabs-title">
        <button className={role === "buyer" ? "on" : ""} onClick={() => setRole("buyer")}>Mis compras</button>
        <button className={role === "seller" ? "on" : ""} onClick={() => setRole("seller")}>Mis ventas</button>
      </div>
      {err && <div className="error">{err}</div>}
      {orders === null && <p className="empty">Cargando…</p>}
      {orders?.length === 0 && <p className="empty">Todavía no hay {seller ? "ventas" : "compras"}.</p>}
      <div className="feed">
        {orders?.map((o) => (
          <div key={o.id} className="card order">
            <div className="grow">
              <span className={`kind kind-${o.kind}`}>{KINDS[o.kind].icon} {KINDS[o.kind].label}</span>
              <h3>{o.post_id ? <Link href={`/red/post/${o.post_id}`}>{o.post_title}</Link> : o.post_title}{o.quantity > 1 && ` ×${o.quantity}`}</h3>
              <small className="muted">
                {seller ? `Comprador: ${o.buyer_name} (@${o.buyer_username})` : `Vendedor: ${o.seller_name} (@${o.seller_username})`} · {timeAgo(o.created_at)}
              </small>
              {o.note && <p className="small">“{o.note}”</p>}
            </div>
            <div className="order-side">
              <strong>{money(o.amount)}</strong>
              {seller && <small className="muted">neto {money(o.amount - o.fee)}</small>}
              <span className={`prio ${o.status === "paid" || o.status === "pending" ? "prio-medium" : o.status === "cancelled" ? "prio-high" : "prio-low"}`}>{ORDER_STATUS[o.status]}</span>
              {!seller && o.status === "pending" && o.payment_url && (
                <a className="pill solid" href={o.payment_url} target="_blank" rel="noopener noreferrer">Pagar con Mercado Pago</a>
              )}
              {seller && (o.status === "pending" || o.status === "paid") && (
                <div className="row end">
                  {o.status === "pending" ? (
                    <button className="pill solid" onClick={() => setStatus(o.id, "paid")}>Confirmar pago recibido</button>
                  ) : (
                    <button className="pill solid" onClick={() => setStatus(o.id, "fulfilled")}>{o.kind === "product" ? "Entregado" : "Realizado"}</button>
                  )}
                  <button className="pill" onClick={() => setStatus(o.id, "cancelled")}>Cancelar</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
