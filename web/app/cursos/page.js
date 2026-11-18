"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDuration, pct } from "../../lib/format";

export default function Cursos() {
  const [courses, setCourses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCourses(await api("/courses"));
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      await api("/courses", { method: "POST", body: JSON.stringify({ url }) });
      setUrl("");
      await load();
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const inProgress = courses.filter((c) => c.completed < c.total).length;

  return (
    <>
      <header className="page-head">
        <h1 className="title">Cursos</h1>
        <span className="muted">
          {courses.length} {courses.length === 1 ? "curso" : "cursos"} · {inProgress} en progreso
        </span>
      </header>

      {error && <div className="error">{error}</div>}

      <form className="inline-form" onSubmit={add}>
        <input
          className="field"
          placeholder="Pegá el link de una lista de reproducción de YouTube"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
        />
        <button className="pill solid" disabled={busy || !url.trim()}>
          {busy ? "Importando…" : "Crear curso"}
        </button>
      </form>

      {loaded && courses.length === 0 && (
        <div className="card empty">Todavía no tenés cursos. Pegá el link de una lista para crear el primero.</div>
      )}

      <div className="grid courses-grid">
        {courses.map((c) => {
          const p = pct(c);
          return (
            <Link key={c.id} href={`/cursos/${c.id}`} className="card course-card">
              <div className="course-thumb" style={{ backgroundImage: `url(${c.thumbnail})` }}>
                {p === 100 && <span className="course-done">Completado</span>}
              </div>
              <h2 className="clamp">{c.title}</h2>
              <p className="muted course-sub">{c.channel}</p>
              <div className="alloc"><i style={{ width: `${p}%` }} /></div>
              <div className="course-meta">
                <span>{c.completed}/{c.total} clases · {p}%</span>
                <span className="muted">
                  {c.completed < c.total ? `${fmtDuration(c.total_seconds - c.done_seconds)} restantes` : fmtDuration(c.total_seconds)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
