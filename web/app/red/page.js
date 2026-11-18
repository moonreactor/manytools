"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Composer from "../../components/red/Composer";
import PostCard from "../../components/red/PostCard";
import { KINDS, sapi, useSocial } from "../../lib/social";

function Feed() {
  const { me, ready, interests } = useSocial();
  const router = useRouter();
  const params = useSearchParams();
  const interest = params.get("interest") || "";
  const [kind, setKind] = useState("");
  const [mine, setMine] = useState(true);
  const [q, setQ] = useState("");
  const [posts, setPosts] = useState(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");

  const query = useCallback(
    (before) => {
      const p = new URLSearchParams();
      if (interest) p.set("interest", interest);
      if (kind) p.set("kind", kind);
      if (q.trim()) p.set("q", q.trim());
      if (me && mine && !interest) p.set("feed", "mine");
      if (before) p.set("before", before);
      return `/posts?${p}`;
    },
    [interest, kind, q, me, mine]
  );

  useEffect(() => {
    if (!ready) return;
    setPosts(null);
    const t = setTimeout(() => {
      sapi(query())
        .then((r) => { setPosts(r); setMore(r.length === 20); setErr(""); })
        .catch((e) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [ready, query]);

  async function loadMore() {
    const r = await sapi(query(posts[posts.length - 1].id));
    setPosts([...posts, ...r]);
    setMore(r.length === 20);
  }

  const current = interests.find((i) => i.slug === interest);
  return (
    <>
      <header className="page-head">
        <h1 className="title">{current ? `${current.emoji} ${current.name}` : "Tu red"}</h1>
      </header>

      {me ? (
        <Composer defaultInterest={current?.id} onCreated={(p) => setPosts((ps) => [p, ...(ps || [])])} />
      ) : ready ? (
        <div className="card paybox" style={{ marginBottom: 20 }}>
          <strong>Compartí lo que sabés y vendelo.</strong>
          <p className="muted">Publicá notas, productos o servicios por tus intereses.</p>
          <Link href="/red/login" className="pill solid">Crear cuenta o ingresar</Link>
        </div>
      ) : null}

      <div className="filters" style={{ margin: "0 0 12px" }}>
        <button className={`pill ${!interest ? "on" : ""}`} onClick={() => router.push("/red")}>Todos</button>
        {interests.map((i) => (
          <button key={i.id} className={`pill ${interest === i.slug ? "on" : ""}`} onClick={() => router.push(`/red?interest=${i.slug}`)}>
            {i.emoji} {i.name}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="tabs-pill">
          <button className={!kind ? "on" : ""} onClick={() => setKind("")}>Todo</button>
          {Object.entries(KINDS).map(([k, v]) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{v.icon} {v.label}s</button>
          ))}
        </div>
        <input className="field search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        {me && !interest && (
          <label className="small muted">
            <input type="checkbox" className="check" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Solo mis intereses
          </label>
        )}
      </div>

      {err && <div className="error">{err}</div>}
      {posts === null && !err && <p className="empty">Cargando…</p>}
      {posts?.length === 0 && (
        <p className="empty">
          No hay publicaciones todavía.{me && mine && !interest ? " Probá sacar “Solo mis intereses” o elegí intereses en tu perfil." : ""}
        </p>
      )}
      <div className="feed">
        {posts?.map((p) => <PostCard key={p.id} post={p} />)}
      </div>
      {more && <div style={{ textAlign: "center", marginTop: 16 }}><button className="pill" onClick={loadMore}>Ver más</button></div>}
    </>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Feed /></Suspense>;
}
