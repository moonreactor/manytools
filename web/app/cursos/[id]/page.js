"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { fmtClock, fmtDuration, pct } from "../../../lib/format";

const THRESHOLD = 0.7;
let ytReady;
function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return ytReady;
}

// Reproductor que mide el tiempo realmente visto (los saltos hacia adelante no cuentan)
// y avisa a la página periódicamente.
function Player({ video, autoStart, onProgress, onEnded }) {
  const box = useRef(null);
  const cb = useRef(onProgress);
  cb.current = onProgress;
  const ended = useRef(onEnded);
  ended.current = onEnded;

  useEffect(() => {
    let player, timer, dead = false;
    // Tramos [inicio, fin] realmente reproducidos, sin doble conteo si se re-mira algo.
    let base = video.watched || 0; // ya guardado de sesiones anteriores (se suma)
    let segs = [];
    let sent = base;
    let last = null; // { t: posición del video, w: reloj real }
    const host = document.createElement("div");
    box.current.appendChild(host);

    const covered = () => {
      const sorted = segs.map((s) => [...s]).sort((x, y) => x[0] - y[0]);
      let total = 0, end = -1, start = 0;
      for (const [a, b] of sorted) {
        if (a > end) {
          if (end >= 0) total += end - start;
          start = a;
          end = b;
        } else end = Math.max(end, b);
      }
      if (end >= 0) total += end - start;
      return total;
    };
    const total = () => Math.min(video.duration, base + covered());
    const flush = () => {
      const w = total();
      if (w > sent) {
        sent = w;
        cb.current(video.id, Math.floor(w));
      }
    };
    const tick = (wasPlaying = false) => {
      if (!player?.getPlayerState) return;
      const now = performance.now() / 1000;
      const t = player.getCurrentTime();
      if (wasPlaying || player.getPlayerState() === 1) {
        if (last) {
          const dt = t - last.t;
          const wall = now - last.w;
          const rate = player.getPlaybackRate?.() || 1;
          // avance coherente con el tiempo real y la velocidad => reproducción, no un salto
          if (dt > 0 && dt <= wall * rate + 1.5) segs.push([last.t, t]);
        }
        last = { t, w: now };
      } else {
        last = null;
      }
      const w = total();
      if (w - sent >= 10 || (w >= video.duration * THRESHOLD && sent < video.duration * THRESHOLD)) flush();
    };

    loadYT().then((YT) => {
      if (dead) return;
      player = new YT.Player(host, {
        videoId: video.video_id,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, autoplay: autoStart ? 1 : 0 },
        events: {
          onStateChange: (e) => {
            if (e.data !== 1) {
              tick(true); // cierra el último tramo antes de pausar/terminar
              last = null;
              flush();
            }
            if (e.data === 0) ended.current?.();
          },
        },
      });
      timer = setInterval(tick, 500);
    });

    return () => {
      dead = true;
      clearInterval(timer);
      flush();
      try {
        player?.destroy();
      } catch {}
      host.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  return <div className="player" ref={box} />;
}

export default function Curso() {
  const { id } = useParams();
  const router = useRouter();
  const [course, setCourse] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);

  const apply = useCallback((c) => {
    setCourse(c);
    setCurrentId((cur) => {
      if (cur && c.videos.some((v) => v.id === cur)) return cur;
      const resume = c.videos.find((v) => v.id === c.last_video_id);
      return (resume || c.videos.find((v) => !v.completed_at) || c.videos[0])?.id ?? null;
    });
  }, []);

  useEffect(() => {
    api(`/courses/${id}`).then(apply).catch((e) => setError(e.message));
  }, [id, apply]);

  const run = async (fn) => {
    try {
      await fn();
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };

  const current = useMemo(() => course?.videos.find((v) => v.id === currentId), [course, currentId]);
  const index = course && current ? course.videos.indexOf(current) : -1;
  const next = course && index >= 0 ? course.videos[index + 1] : null;

  const reportProgress = useCallback(
    (videoId, watched) => {
      api(`/courses/${id}/videos/${videoId}/progress`, { method: "POST", body: JSON.stringify({ watched }) })
        .then(({ video, course: summary }) =>
          setCourse((c) =>
            c && { ...c, ...summary, videos: c.videos.map((v) => (v.id === video.id ? video : v)) }
          )
        )
        .catch(() => {});
    },
    [id]
  );

  const [autoStartId, setAutoStartId] = useState(null);

  const setAutoplay = (autoplay) => {
    setCourse((c) => ({ ...c, autoplay })); // optimista
    api(`/courses/${id}`, { method: "PATCH", body: JSON.stringify({ autoplay }) }).catch((e) => {
      setCourse((c) => ({ ...c, autoplay: !autoplay }));
      setError(e.message);
    });
  };

  const select = (v) => {
    setCurrentId(v.id);
    api(`/courses/${id}/current`, { method: "PUT", body: JSON.stringify({ video_id: v.id }) }).catch(() => {});
  };

  const toggle = (v, completed) =>
    run(async () => apply(await api(`/courses/${id}/videos/${v.id}`, { method: "PATCH", body: JSON.stringify({ completed }) })));

  const finishAndNext = () =>
    run(async () => {
      const c = await api(`/courses/${id}/videos/${current.id}`, { method: "PATCH", body: JSON.stringify({ completed: true }) });
      apply(c);
      if (next) select(next);
    });

  const sync = () => {
    setSyncing(true);
    run(async () => apply(await api(`/courses/${id}/sync`, { method: "POST" }))).finally(() => setSyncing(false));
  };

  const rename = () =>
    run(async () => {
      const title = prompt("Nombre del curso", course.title);
      if (!title || !title.trim() || title === course.title) return;
      apply(await api(`/courses/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }));
    });

  const remove = () =>
    run(async () => {
      if (!confirm("¿Eliminar este curso y su progreso?")) return;
      await api(`/courses/${id}`, { method: "DELETE" });
      router.push("/cursos");
    });

  if (!course) {
    return error ? <div className="error">{error}</div> : <p className="muted">Cargando…</p>;
  }

  const p = pct(course);
  const remaining = course.total_seconds - course.done_seconds;

  return (
    <>
      <Link href="/cursos" className="muted back">← Cursos</Link>
      <header className="page-head course-head">
        <div>
          <h1 className="title">{course.title}</h1>
          <p className="muted">{course.channel}</p>
        </div>
        <div className="course-actions">
          <button className="pill" onClick={sync} disabled={syncing}>{syncing ? "Actualizando…" : "Actualizar lista"}</button>
          <button className="pill" onClick={rename}>Renombrar</button>
          <button className="pill danger" onClick={remove}>Eliminar</button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="metrics">
        <div className="metric"><span className="muted">Avance</span><strong>{p}%</strong></div>
        <div className="metric"><span className="muted">Clases</span><strong>{course.completed} / {course.total}</strong></div>
        <div className="metric"><span className="muted">Tiempo visto</span><strong>{fmtDuration(course.done_seconds)}</strong></div>
        <div className="metric"><span className="muted">Restante</span><strong>{fmtDuration(remaining)}</strong></div>
      </div>
      <div className="alloc course-bar"><i style={{ width: `${p}%` }} /></div>

      <div className="course-layout">
        <section>
          {current && (
            <>
              <Player
                video={current}
                autoStart={current.id === autoStartId}
                onProgress={reportProgress}
                onEnded={() => {
                  if (course.autoplay && next) {
                    setAutoStartId(next.id);
                    select(next);
                  }
                }}
              />
              <h2 className="now-title">{index + 1}. {current.title}</h2>
              <div className="modal-actions">
                {current.completed_at ? (
                  <button className="pill" onClick={() => toggle(current, false)}>✓ Completada · desmarcar</button>
                ) : (
                  <button className="pill solid" onClick={finishAndNext}>
                    {next ? "Completar y siguiente" : "Completar"}
                  </button>
                )}
                {next && <button className="pill" onClick={() => select(next)}>Siguiente →</button>}
                <label className="switch">
                  <input type="checkbox" role="switch" checked={course.autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
                  <i />
                  <span>Avanzar automáticamente</span>
                </label>
                {!current.completed_at && (
                  <span className="muted">
                    Visto {Math.min(100, Math.round((current.watched / current.duration) * 100))}% · se completa al llegar al 70%
                  </span>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="lessons">
          {course.videos.map((v, i) => (
            <div key={v.id} className={`lesson${v.id === currentId ? " on" : ""}${v.completed_at ? " is-done" : ""}`}>
              <input
                type="checkbox"
                className="check"
                checked={!!v.completed_at}
                onChange={(e) => toggle(v, e.target.checked)}
                aria-label="Marcar como completada"
              />
              <button className="lesson-btn" onClick={() => select(v)}>
                <span className="t clamp">{i + 1}. {v.title}</span>
                <span className="sub">{fmtClock(v.duration)}</span>
              </button>
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
