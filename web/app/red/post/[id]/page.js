"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Composer from "../../../../components/red/Composer";
import PayBox from "../../../../components/red/PayBox";
import PostCard from "../../../../components/red/PostCard";
import { timeAgo } from "../../../../lib/format";
import { sapi, useSocial } from "../../../../lib/social";

export default function PostPage() {
  const { id } = useParams();
  const { me, ready } = useSocial();
  const router = useRouter();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [rev, setRev] = useState(0);

  const load = useCallback(() => {
    sapi(`/posts/${id}`).then(setPost).catch((e) => setErr(e.message));
    sapi(`/posts/${id}/comments`).then(setComments).catch(() => {});
  }, [id]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  async function comment(e) {
    e.preventDefault();
    try {
      const c = await sapi(`/posts/${id}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
      setComments([...comments, c]);
      setText("");
    } catch (e) {
      setErr(e.message);
    }
  }

  async function archive() {
    if (!confirm("¿Archivar esta publicación? Las órdenes existentes se conservan.")) return;
    await sapi(`/posts/${id}`, { method: "DELETE" });
    router.push("/red");
  }

  if (err && !post) return <div className="error">{err}</div>;
  if (!post) return <p className="empty">Cargando…</p>;
  return (
    <div className="post-page">
      <div>
        {editing ? (
          <Composer post={post} onCancel={() => setEditing(false)} onCreated={(p) => { setPost(p); setRev(rev + 1); setEditing(false); }} />
        ) : (
          <PostCard key={rev} post={post} full />
        )}
        {me?.id === post.author_id && post.status === "active" && !editing && (
          <div className="row">
            <button className="pill" onClick={() => setEditing(true)}>✏️ Editar</button>
            <button className="link" onClick={archive}>Archivar publicación</button>
          </div>
        )}
        <h3 className="sec">Comentarios ({comments.length})</h3>
        {comments.map((c) => (
          <div key={c.id} className="comment">
            <strong>{c.display_name}</strong> <small className="muted">@{c.username} · {timeAgo(c.created_at)}</small>
            <p>{c.body}</p>
          </div>
        ))}
        {me ? (
          <form className="inline-form" onSubmit={comment}>
            <input className="field" placeholder="Escribí un comentario…" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
            <button className="pill solid" disabled={!text.trim()}>Enviar</button>
          </form>
        ) : <p className="hint">Ingresá para comentar.</p>}
        {err && <div className="error">{err}</div>}
      </div>
      {post.status === "active" && <PayBox post={post} onPaid={load} />}
    </div>
  );
}
