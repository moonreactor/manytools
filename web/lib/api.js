const API = process.env.NEXT_PUBLIC_API_URL;

export async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail;
    try {
      detail = (await res.json()).detail;
    } catch {}
    throw new Error(typeof detail === "string" ? detail : `Error ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}
