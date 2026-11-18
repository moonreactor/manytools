"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Avatar from "../../../../components/Avatar";
import PostCard, { colorFor } from "../../../../components/red/PostCard";
import { sapi, useSocial } from "../../../../lib/social";

export default function Profile() {
  const { username } = useParams();
  const { me, setMe, ready, interests } = useSocial();
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState(null);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ display_name: "", bio: "" });
  const [picked, setPicked] = useState([]);
  const isMe = me?.username === username;

  useEffect(() => {
    if (!ready) return;
    sapi(`/users/${username}`).then(setUser).catch((e) => setErr(e.message));
    sapi(`/posts?author=${username}`).then(setPosts).catch(() => setPosts([]));
  }, [ready, username]);

  function startEdit() {
    setForm({ display_name: user.display_name, bio: user.bio });
    setPicked(user.interests.map((i) => i.id));
    setEdit(true);
  }

  async function save(e) {
    e.preventDefault();
    try {
      const u = await sapi("/me", { method: "PUT", body: JSON.stringify(form) });
      await sapi("/me/interests", { method: "PUT", body: JSON.stringify({ ids: picked }) });
      setMe(u);
      setUser({ ...user, ...u, interests: interests.filter((i) => picked.includes(i.id)) });
      setEdit(false);
    } catch (e) {
      setErr(e.message);
    }
  }

  if (err && !user) return <div className="error">{err}</div>;
  if (!user) return <p className="empty">Cargando…</p>;
  return (
    <>
      <header className="profile-head">
        <Avatar name={user.display_name} color={colorFor(user.username)} size={72} />
        <div className="grow">
          <h1 className="title">{user.display_name}</h1>
          <span className="muted">@{user.username} · {user.posts} publicaciones</span>
          {user.bio && <p style={{ marginTop: 8 }}>{user.bio}</p>}
          <div className="people">
            {user.interests.map((i) => <span key={i.id} className="chip-int">{i.emoji} {i.name}</span>)}
          </div>
        </div>
        {isMe && !edit && <button className="pill" onClick={startEdit}>Editar perfil</button>}
      </header>

      {edit && (
        <form className="card composer" onSubmit={save}>
          <input className="field full" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} maxLength={50} required />
          <textarea className="field full area" rows={2} placeholder="Bio" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={300} />
          <div className="filters" style={{ margin: "0 0 12px" }}>
            {interests.map((i) => (
              <button type="button" key={i.id} className={`pill ${picked.includes(i.id) ? "on" : ""}`} onClick={() => setPicked((p) => (p.includes(i.id) ? p.filter((x) => x !== i.id) : [...p, i.id]))}>
                {i.emoji} {i.name}
              </button>
            ))}
          </div>
          <div className="row end">
            <button type="button" className="pill" onClick={() => setEdit(false)}>Cancelar</button>
            <button className="pill solid">Guardar</button>
          </div>
        </form>
      )}

      {err && <div className="error">{err}</div>}
      {posts?.length === 0 && <p className="empty">Todavía no publicó nada.</p>}
      <div className="feed">{posts?.map((p) => <PostCard key={p.id} post={p} />)}</div>
    </>
  );
}
