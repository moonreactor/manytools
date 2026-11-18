"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "../Money";
import { timeAgo } from "../../lib/format";
import { KINDS, sapi, useSocial } from "../../lib/social";
import Avatar from "../Avatar";

const COLORS = ["#5865f2", "#23a559", "#f0b232", "#eb459e", "#00a8fc", "#e67e22"];
export const colorFor = (s) => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

export default function PostCard({ post: initial, full = false }) {
  const { me } = useSocial();
  const router = useRouter();
  const [post, setPost] = useState(initial);
  const k = KINDS[post.kind];

  async function like() {
    if (!me) return router.push("/red/login");
    try {
      setPost(await sapi(`/posts/${post.id}/like`, { method: "POST" }));
    } catch {}
  }

  const soldOut = post.kind === "product" && post.stock === 0;
  return (
    <article className="card post">
      <header className="post-head">
        <Avatar name={post.display_name} color={colorFor(post.username)} size={36} />
        <div className="grow">
          <Link href={`/red/u/${post.username}`} className="post-author">{post.display_name}</Link>
          <small className="muted"> @{post.username} · {timeAgo(post.created_at)}</small>
        </div>
        <Link href={`/red?interest=${post.interest_slug}`} className="chip-int">
          {post.interest_emoji} {post.interest_name}
        </Link>
      </header>

      <Link href={`/red/post/${post.id}`} className="post-main">
        <span className={`kind kind-${post.kind}`}>{k.icon} {k.label}</span>
        <h2>{post.title}</h2>
        {post.body && <p className={full ? "post-body" : "post-body clamp"}>{post.body}</p>}
        {post.image_url && <img className="post-img" src={post.image_url} alt="" loading="lazy" />}
      </Link>

      <footer className="post-foot">
        <button className={`act ${post.liked ? "liked" : ""}`} onClick={like}>
          {post.liked ? "♥" : "♡"} {post.likes}
        </button>
        <Link className="act" href={`/red/post/${post.id}`}>💬 {post.comments}</Link>
        {post.sales > 0 && <span className="muted small">{post.sales} {post.kind === "note" ? "aportes" : "ventas"}</span>}
        <span className="grow" />
        {post.price != null && <strong className="price">{money(post.price)}{post.kind === "service" && <small className="muted"> desde</small>}</strong>}
        {post.kind === "product" && post.stock != null && (
          <small className={soldOut ? "neg" : "muted"}>{soldOut ? "Sin stock" : `${post.stock} en stock`}</small>
        )}
        {!full && !soldOut && (
          <Link href={`/red/post/${post.id}#pagar`} className="pill solid">{k.cta}</Link>
        )}
      </footer>
    </article>
  );
}
