"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tools } from "../lib/tools";

// Estilo Discord: rail de "servidores" + lista de "canales" (las herramientas).
export default function Navbar() {
  const pathname = usePathname();
  const current = tools.find((t) => pathname.startsWith(`/${t.slug}`));

  return (
    <>
      <aside className="rail">
        <Link href="/" className={`rail-btn home ${!current ? "active" : ""}`} title="ManyTools">
          ✦
        </Link>
        <span className="rail-sep" />
        {tools.map((t) => (
          <Link
            key={t.slug}
            href={`/${t.slug}`}
            title={t.name}
            className={`rail-btn ${current?.slug === t.slug ? "active" : ""}`}
          >
            {t.icon}
          </Link>
        ))}
      </aside>

      <aside className="channels">
        <Link href="/" className="server-head">
          ManyTools
          <span className="muted">⌄</span>
        </Link>
        <div className="channels-body">
          <div className="cat">Herramientas</div>
          {tools.map((t) => (
            <Link
              key={t.slug}
              href={`/${t.slug}`}
              className={`channel ${current?.slug === t.slug ? "active" : ""}`}
            >
              <span className="hash">#</span>
              {t.slug}
            </Link>
          ))}
        </div>
        <div className="userbar">
          <span className="user-avatar">C</span>
          <div>
            <strong>Cristian</strong>
            <small>En línea</small>
          </div>
        </div>
      </aside>

      <header className="topbar">
        <span className="hash">#</span>
        <strong>{current ? current.slug : "inicio"}</strong>
        {current && <span className="topbar-desc">{current.description}</span>}
      </header>
    </>
  );
}
