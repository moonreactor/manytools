"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { tools } from "../lib/tools";

export default function Home() {
  const [state, setState] = useState("loading");

  useEffect(() => {
    api("/health")
      .then((d) => setState(d.status === "ok" ? "ok" : "error"))
      .catch(() => setState("error"));
  }, []);

  return (
    <>
      <header className="page-head">
        <h1 className="title">Herramientas</h1>
        <span className={`pill status ${state}`}>
          <i /> API {{ loading: "...", ok: "OK", error: "ERROR" }[state]}
        </span>
      </header>
      <div className="grid">
        {tools.map((t) => (
          <Link key={t.slug} href={`/${t.slug}`} className="card tool-card">
            <div className="tool-icon">{t.icon}</div>
            <h2>{t.name}</h2>
            <p className="muted">{t.description}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
