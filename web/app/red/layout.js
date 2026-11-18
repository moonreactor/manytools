"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SocialProvider, useSocial } from "../../lib/social";

function SubNav() {
  const { me, ready, signOut } = useSocial();
  const path = usePathname();
  const tab = (href, label) => (
    <Link href={href} className={`pill ${path === href ? "on" : ""}`}>
      {label}
    </Link>
  );
  return (
    <nav className="red-nav">
      {tab("/red", "Inicio")}
      {me && tab("/red/ordenes", "Compras y ventas")}
      {me && tab(`/red/u/${me.username}`, "Mi perfil")}
      <span className="grow" />
      {ready &&
        (me ? (
          <>
            <span className="muted">@{me.username}</span>
            <button className="pill" onClick={signOut}>Salir</button>
          </>
        ) : (
          <Link href="/red/login" className="pill solid">Ingresar</Link>
        ))}
    </nav>
  );
}

export default function RedLayout({ children }) {
  return (
    <SocialProvider>
      <SubNav />
      {children}
    </SocialProvider>
  );
}
