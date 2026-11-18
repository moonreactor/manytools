"use client";

import { useCallback, useEffect, useState } from "react";
import Avatar from "../../components/Avatar";
import Money, { money } from "../../components/Money";
import TrendChart from "../../components/TrendChart";
import { api } from "../../lib/api";

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD local

const emptyForm = () => ({
  type: "expense",
  amount: "",
  category_id: "",
  profile_id: "",
  description: "",
  date: today(),
});

const TABS = [
  ["movs", "Movimientos"],
  ["cats", "Por categoría"],
  ["profiles", "Perfiles"],
  ["trend", "Tendencia"],
  ["manage", "Categorías"],
];

const pctChange = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

export default function Finanzas() {
  const [month, setMonth] = useState("");
  const [tab, setTab] = useState("movs");
  const [profileFilter, setProfileFilter] = useState(""); // "" = todos
  const [categories, setCategories] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [newCat, setNewCat] = useState({ name: "", type: "expense" });
  const [newProfile, setNewProfile] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setMonth(today().slice(0, 7)), []);

  // Al filtrar por un perfil, los nuevos movimientos se asignan a ese perfil.
  useEffect(() => {
    setForm((f) => ({ ...f, profile_id: profileFilter }));
  }, [profileFilter]);

  const loadCategories = useCallback(
    () => api("/finance/categories").then(setCategories),
    []
  );
  const loadProfiles = useCallback(
    () => api("/finance/profiles").then(setProfiles),
    []
  );

  const loadMonth = useCallback(async () => {
    if (!month) return;
    const pf = profileFilter ? `&profile_id=${profileFilter}` : "";
    const [tx, sum, met] = await Promise.all([
      api(`/finance/transactions?month=${month}${pf}`),
      api(`/finance/summary?month=${month}${pf}`),
      api(`/finance/metrics?month=${month}&today=${today()}${pf}`),
    ]);
    setTransactions(tx);
    setSummary(sum);
    setMetrics(met);
  }, [month, profileFilter]);

  const run = async (fn) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    run(loadCategories);
    run(loadProfiles);
  }, [loadCategories, loadProfiles]);

  useEffect(() => {
    run(loadMonth);
  }, [loadMonth]);

  const amountValid = parseFloat(form.amount) > 0;

  const addTransaction = (e) => {
    e.preventDefault();
    if (!amountValid) return;
    run(async () => {
      await api("/finance/transactions", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          amount: parseFloat(form.amount),
          category_id: form.category_id ? Number(form.category_id) : null,
          profile_id: form.profile_id ? Number(form.profile_id) : null,
        }),
      });
      setForm((f) => ({
        ...emptyForm(),
        type: f.type,
        date: f.date,
        profile_id: f.profile_id,
      }));
      const txMonth = form.date.slice(0, 7);
      if (txMonth !== month) setMonth(txMonth);
      else await loadMonth();
    });
  };

  const removeTransaction = (id) =>
    run(async () => {
      await api(`/finance/transactions/${id}`, { method: "DELETE" });
      await loadMonth();
    });

  const addCategory = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/finance/categories", {
        method: "POST",
        body: JSON.stringify(newCat),
      });
      setNewCat((c) => ({ ...c, name: "" }));
      await loadCategories();
    });
  };

  const removeCategory = (id) =>
    run(async () => {
      await api(`/finance/categories/${id}`, { method: "DELETE" });
      await Promise.all([loadCategories(), loadMonth()]);
    });

  const addProfile = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/finance/profiles", {
        method: "POST",
        body: JSON.stringify({ name: newProfile }),
      });
      setNewProfile("");
      await Promise.all([loadProfiles(), loadMonth()]);
    });
  };

  const removeProfile = (id) =>
    run(async () => {
      await api(`/finance/profiles/${id}`, { method: "DELETE" });
      if (profileFilter === String(id)) setProfileFilter("");
      await Promise.all([loadProfiles(), loadMonth()]);
    });

  const income = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;
  const balance = summary?.balance ?? 0;
  const formCategories = categories.filter((c) => c.type === form.type);
  const isExpense = form.type === "expense";
  const expenseChange = metrics ? pctChange(expense, metrics.previous.expense) : null;
  const incomeChange = metrics ? pctChange(income, metrics.previous.income) : null;
  const biggest = metrics?.biggest_expense;
  const activeProfile = profiles.find((p) => String(p.id) === profileFilter);
  const changeLabel = (v, goodWhenUp) =>
    v === null ? (
      <span className="muted">—</span>
    ) : (
      <span className={v === 0 ? "muted" : (v > 0) === goodWhenUp ? "pos" : "neg"}>
        {v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%
      </span>
    );

  return (
    <>
      <header className="portfolio">
        <div>
          <span className="muted">
            Balance del mes{activeProfile ? ` · ${activeProfile.name}` : ""}
          </span>
          <div className="balance">
            <Money value={balance} />
          </div>
          <div className="deltas">
            <span className="pos">▲ Ingresos {money(income)}</span>
            <span className="neg">▼ Gastos {money(expense)}</span>
          </div>
        </div>
        <input
          className="pill"
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </header>

      {profiles.length > 0 && (
        <div className="filters">
          <button
            className={`pill ${profileFilter === "" ? "on" : ""}`}
            onClick={() => setProfileFilter("")}
          >
            Todos
          </button>
          {profiles.map((p) => (
            <button
              key={p.id}
              className={`pill ${profileFilter === String(p.id) ? "on" : ""}`}
              onClick={() => setProfileFilter(String(p.id))}
            >
              <Avatar name={p.name} color={p.color} size={18} /> {p.name}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <section className="metrics">
        <div className="metric">
          <span className="muted">Tasa de ahorro</span>
          <strong className={metrics?.savings_rate < 0 ? "neg" : ""}>
            {metrics?.savings_rate == null ? "—" : `${metrics.savings_rate.toFixed(1)}%`}
          </strong>
        </div>
        <div className="metric">
          <span className="muted">Gasto diario promedio</span>
          <strong>{money(metrics?.avg_daily_expense ?? 0)}</strong>
        </div>
        <div className="metric">
          <span className="muted">Proyección de gastos</span>
          <strong>
            {metrics?.projected_expense == null ? "—" : money(metrics.projected_expense)}
          </strong>
        </div>
        <div className="metric">
          <span className="muted">Mayor gasto</span>
          <strong>{biggest ? money(biggest.amount) : "—"}</strong>
          {biggest && (
            <span className="sub">{biggest.description || biggest.category || "Sin detalle"}</span>
          )}
        </div>
        <div className="metric">
          <span className="muted">Gastos vs mes anterior</span>
          <strong>{changeLabel(expenseChange, false)}</strong>
        </div>
        <div className="metric">
          <span className="muted">Ingresos vs mes anterior</span>
          <strong>{changeLabel(incomeChange, true)}</strong>
        </div>
      </section>

      <div className="fin-grid">
        <section className="swap">
          <div className="tabs-pill">
            {[
              ["expense", "Gasto"],
              ["income", "Ingreso"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={form.type === value ? "on" : ""}
                onClick={() => setForm((f) => ({ ...f, type: value, category_id: "" }))}
              >
                {label}
              </button>
            ))}
          </div>
          <form onSubmit={addTransaction}>
            <div className="box">
              <span className="box-label">Monto</span>
              <div className="box-row">
                <input
                  className="big"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
                <select
                  className="pill token"
                  value={form.category_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category_id: e.target.value }))
                  }
                >
                  <option value="">Sin categoría</option>
                  {formCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="box">
              <span className="box-label">
                {isExpense ? "Quién gastó" : "Quién recibió"}
              </span>
              {profiles.length ? (
                <div className="people">
                  <button
                    type="button"
                    className={`pill ${form.profile_id === "" ? "on" : ""}`}
                    onClick={() => setForm((f) => ({ ...f, profile_id: "" }))}
                  >
                    Nadie
                  </button>
                  {profiles.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className={`pill ${form.profile_id === String(p.id) ? "on" : ""}`}
                      onClick={() => setForm((f) => ({ ...f, profile_id: String(p.id) }))}
                    >
                      <Avatar name={p.name} color={p.color} size={18} /> {p.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="hint">
                  Creá perfiles (familia, equipo…) en la pestaña{" "}
                  <button type="button" className="link" onClick={() => setTab("profiles")}>
                    Perfiles
                  </button>
                  .
                </p>
              )}
            </div>
            <div className="box">
              <span className="box-label">Detalle</span>
              <div className="box-row">
                <input
                  className="text"
                  placeholder="Descripción (opcional)"
                  maxLength={200}
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
                <input
                  className="pill"
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
            </div>
            <button className="cta" disabled={!amountValid}>
              {amountValid
                ? isExpense
                  ? "Agregar gasto"
                  : "Agregar ingreso"
                : "Ingresá un monto"}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="tabs-title">
            {TABS.map(([value, label]) => (
              <button
                key={value}
                className={tab === value ? "on" : ""}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "movs" && (
            <div className="table-card">
              <div className="thead movs">
                <span>Fecha</span>
                <span>Detalle</span>
                <span className="r">Monto</span>
                <span />
              </div>
              {transactions.length ? (
                transactions.map((t) => (
                  <div className="trow movs" key={t.id}>
                    <span className="muted">{t.date}</span>
                    <span>
                      {t.description || <span className="muted">—</span>}
                      <span className="sub">
                        {t.profile && (
                          <>
                            <Avatar name={t.profile} color={t.profile_color} size={14} />{" "}
                            {t.profile} ·{" "}
                          </>
                        )}
                        {t.category || "Sin categoría"}
                      </span>
                    </span>
                    <span className={`r ${t.type === "income" ? "pos" : "neg"}`}>
                      <small>{t.type === "income" ? "▲" : "▼"}</small>{" "}
                      {money(t.amount)}
                    </span>
                    <button
                      className="icon"
                      title="Eliminar"
                      onClick={() => removeTransaction(t.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))
              ) : (
                <p className="empty">No hay movimientos este mes.</p>
              )}
            </div>
          )}

          {tab === "cats" && (
            <div className="table-card">
              <div className="thead cats">
                <span>Categoría</span>
                <span className="r">Gastado</span>
                <span className="r">%</span>
                <span>Allocation</span>
              </div>
              {summary?.expenses_by_category.length ? (
                summary.expenses_by_category.map((c) => {
                  const pct = expense ? (c.total / expense) * 100 : 0;
                  return (
                    <div className="trow cats" key={c.category}>
                      <span>{c.category}</span>
                      <span className="r">{money(c.total)}</span>
                      <span className="r">{pct.toFixed(1)}%</span>
                      <span className="alloc">
                        <i style={{ width: `${pct}%` }} />
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="empty">Sin gastos este mes.</p>
              )}
            </div>
          )}

          {tab === "profiles" && (
            <div className="table-card">
              <form onSubmit={addProfile} className="inline-form card-form">
                <input
                  className="field"
                  placeholder="Nuevo perfil (ej: Mamá, Ventas)"
                  required
                  maxLength={50}
                  value={newProfile}
                  onChange={(e) => setNewProfile(e.target.value)}
                />
                <button className="pill solid">Agregar</button>
              </form>
              <div className="thead profs">
                <span>Perfil</span>
                <span className="r">Ingresos</span>
                <span className="r">Gastos</span>
                <span className="r">Neto</span>
                <span />
              </div>
              {summary?.by_profile.length ? (
                summary.by_profile.map((p) => {
                  const net = p.income - p.expense;
                  return (
                    <div className="trow profs" key={p.id ?? "none"}>
                      <span className="who">
                        <Avatar name={p.name} color={p.color} size={26} /> {p.name}
                      </span>
                      <span className="r pos">{money(p.income)}</span>
                      <span className="r neg">{money(p.expense)}</span>
                      <span className={`r ${net < 0 ? "neg" : ""}`}>{money(net)}</span>
                      {p.id !== null ? (
                        <button
                          className="icon"
                          title="Eliminar perfil"
                          onClick={() => removeProfile(p.id)}
                        >
                          ✕
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="empty">
                  Todavía no hay perfiles. Agregá personas de tu familia o equipo.
                </p>
              )}
            </div>
          )}

          {tab === "trend" && metrics && (
            <TrendChart data={metrics.trend} selected={month} />
          )}

          {tab === "manage" && (
            <div className="table-card pad">
              <form onSubmit={addCategory} className="inline-form">
                <input
                  className="field"
                  placeholder="Nueva categoría"
                  required
                  maxLength={50}
                  value={newCat.name}
                  onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
                />
                <select
                  className="pill"
                  value={newCat.type}
                  onChange={(e) => setNewCat({ ...newCat, type: e.target.value })}
                >
                  <option value="expense">Gasto</option>
                  <option value="income">Ingreso</option>
                </select>
                <button className="pill solid">Agregar</button>
              </form>
              <div className="chips">
                {categories.map((c) => (
                  <span key={c.id} className={`chip ${c.type}`}>
                    <small>{c.type === "income" ? "▲" : "▼"}</small>
                    {c.name}
                    <button title="Eliminar" onClick={() => removeCategory(c.id)}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
