"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

const SLOTS = [
  ["desayuno", "Desayuno", "☕"],
  ["almuerzo", "Almuerzo", "🥗"],
  ["merienda", "Merienda", "🍎"],
  ["cena", "Cena", "🍝"],
];

// Opciones documentadas por recipeapi.io. El valor va en inglés (lo que espera la API); la etiqueta, en español.
const MEAL_TYPES = [
  ["breakfast", "Desayuno"], ["brunch", "Brunch"], ["main", "Plato principal"], ["snack", "Snack"],
  ["soup", "Sopa"], ["side_dish", "Guarnición"], ["starter", "Entrada"], ["appetizer", "Aperitivo"],
  ["dessert", "Postre"], ["drink", "Bebida"], ["sauce", "Salsa"],
];
const CUISINES = [
  ["american", "Estadounidense"], ["brazilian", "Brasileña"], ["british", "Británica"], ["chinese", "China"],
  ["french", "Francesa"], ["german", "Alemana"], ["greek", "Griega"], ["indian", "India"],
  ["italian", "Italiana"], ["japanese", "Japonesa"], ["korean", "Coreana"], ["lebanese", "Libanesa"],
  ["mexican", "Mexicana"], ["moroccan", "Marroquí"], ["peruvian", "Peruana"], ["portuguese", "Portuguesa"],
  ["spanish", "Española"], ["thai", "Tailandesa"], ["turkish", "Turca"], ["vietnamese", "Vietnamita"],
];
const DIFFICULTIES = [["easy", "Fácil"], ["medium", "Media"], ["hard", "Difícil"]];
const DIETS = [
  ["vegetarian", "Vegetariana"], ["vegan", "Vegana"], ["gluten_free", "Sin gluten"], ["dairy_free", "Sin lácteos"],
  ["nut_free", "Sin frutos secos"], ["halal", "Halal"], ["kosher", "Kosher"],
];
const SORTS = [
  ["protein", "Proteína"], ["calories_per_serving", "Calorías"], ["prep_time", "Tiempo de preparación"],
  ["cook_time", "Tiempo de cocción"], ["name", "Nombre"],
];
const label = (list, v) => list.find(([k]) => k === v)?.[1] ?? v;

const EMPTY_FILTERS = {
  search: "", ingredients: "", meal_type: "", cuisine: "", dietary_tags: "", difficulty: "",
  calories_per_serving_max: "", protein_min: "", prep_time_max: "", cook_time_max: "",
  sort: "protein", order: "desc",
};

// Pre-ajustes de búsqueda listos para usar.
const PRESETS = [
  { name: "💪 Bajas en calorías y altas en proteínas", f: { calories_per_serving_max: "500", protein_min: "25" } },
  { name: "☕ Desayuno proteico", f: { meal_type: "breakfast", calories_per_serving_max: "400", protein_min: "20" } },
  { name: "🍗 Principal liviano", f: { meal_type: "main", calories_per_serving_max: "450", protein_min: "30" } },
  { name: "🍎 Snack saludable", f: { meal_type: "snack", calories_per_serving_max: "200", sort: "calories_per_serving", order: "asc" } },
  { name: "🥣 Sopas livianas", f: { meal_type: "soup", calories_per_serving_max: "300" } },
  { name: "⚡ Rápidas (hasta 20 min)", f: { prep_time_max: "20", calories_per_serving_max: "500", protein_min: "20" } },
  { name: "👌 Fáciles", f: { difficulty: "easy", calories_per_serving_max: "500", protein_min: "20" } },
  { name: "🥦 Vegetarianas con proteína", f: { dietary_tags: "vegetarian", protein_min: "20" } },
  { name: "🌱 Veganas", f: { dietary_tags: "vegan", protein_min: "15" } },
  { name: "🌾 Sin gluten", f: { dietary_tags: "gluten_free", calories_per_serving_max: "500", protein_min: "20" } },
];

const iso = (d) => d.toLocaleDateString("sv-SE");
const addDays = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
// Semana de lunes a domingo.
const mondayOf = (d) => {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
};
const fmt = (d, opts) => d.toLocaleDateString("es", opts);

export default function Comidas() {
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const [meals, setMeals] = useState([]);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // { id?, date, slot, title, notes }
  const [keyStatus, setKeyStatus] = useState(null); // { configured, preview }
  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [recipes, setRecipes] = useState(null); // null = sin buscar
  const [searching, setSearching] = useState(false);
  const [rq, setRq] = useState({ ...EMPTY_FILTERS, ...PRESETS[0].f });
  const [activePreset, setActivePreset] = useState(0);
  const [showAdv, setShowAdv] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const start = iso(days[0]);
  const todayIso = iso(new Date());

  const load = useCallback(async () => {
    try {
      setMeals(await api(`/meals?start=${start}`));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [start]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api("/meals/settings").then(setKeyStatus).catch((e) => setError(e.message));
  }, []);

  const saveKey = async (e) => {
    e.preventDefault();
    try {
      setKeyStatus(await api("/meals/settings", { method: "PUT", body: JSON.stringify({ api_key: keyInput }) }));
      setKeyInput("");
      setShowKey(false);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };
  const removeKey = async () => {
    try {
      await api("/meals/settings", { method: "DELETE" });
      setKeyStatus({ configured: false, preview: null });
      setRecipes(null);
      setShowKey(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const runSearch = async (filters) => {
    const qs = new URLSearchParams({ per_page: "10" });
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    setSearching(true);
    try {
      setRecipes((await api(`/meals/recipes?${qs}`)).data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };
  const searchRecipes = (e) => {
    e.preventDefault();
    setActivePreset(null);
    runSearch(rq);
  };
  const applyPreset = (i) => {
    const f = { ...EMPTY_FILTERS, ...PRESETS[i].f };
    setRq(f);
    setActivePreset(i);
    runSearch(f);
  };
  const setF = (k) => (e) => setRq({ ...rq, [k]: e.target.value });

  const useRecipe = (r) => {
    const slot = { breakfast: "desayuno", snack: "merienda" }[r.meal_type] || (r.meal_type === "main" ? "almuerzo" : "cena");
    setModal({
      date: todayIso,
      slot,
      title: r.name,
      notes: `${r.calories_per_serving} kcal · ${r.protein} g prot (por porción)`,
    });
  };

  const byCell = useMemo(() => {
    const m = {};
    for (const meal of meals) (m[`${meal.date}|${meal.slot}`] ||= []).push(meal);
    return m;
  }, [meals]);

  const run = async (fn) => {
    try {
      await fn();
      setModal(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const save = (e) => {
    e.preventDefault();
    const { id, ...body } = modal;
    run(() =>
      api(id ? `/meals/${id}` : "/meals", { method: id ? "PUT" : "POST", body: JSON.stringify(body) }),
    );
  };
  const remove = (id) => run(() => api(`/meals/${id}`, { method: "DELETE" }));
  const set = (k) => (e) => setModal({ ...modal, [k]: e.target.value });

  const last = days[6];
  const rangeLabel = `${fmt(days[0], { day: "numeric", month: "short" })} – ${fmt(last, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
  const isThisWeek = start === iso(mondayOf(new Date()));

  return (
    <>
      <div className="page-head">
        <h1 className="title">Comidas de la semana</h1>
        <div className="week-nav">
          <button className="pill" onClick={() => setShowKey(true)} title="API de recetas">
            {keyStatus?.configured ? "🔑 API" : "🔑 Configurar API"}
          </button>
          <button className="pill" onClick={() => setMonday(addDays(monday, -7))} aria-label="Semana anterior">
            ‹
          </button>
          <button className="pill" disabled={isThisWeek} onClick={() => setMonday(mondayOf(new Date()))}>
            Hoy
          </button>
          <button className="pill" onClick={() => setMonday(addDays(monday, 7))} aria-label="Semana siguiente">
            ›
          </button>
        </div>
      </div>
      <p className="muted week-range">{rangeLabel}</p>

      {error && <div className="error">{error}</div>}

      <div className="week">
        <div className="week-corner" />
        {days.map((d) => (
          <div key={iso(d)} className={`week-day ${iso(d) === todayIso ? "today" : ""}`}>
            <span className="muted">{fmt(d, { weekday: "short" })}</span>
            <strong>{d.getDate()}</strong>
          </div>
        ))}

        {SLOTS.map(([slot, label, icon]) => (
          <WeekRow key={slot} slot={slot} label={label} icon={icon} days={days} todayIso={todayIso} byCell={byCell} setModal={setModal} />
        ))}
      </div>

      <section className="recipes">
        <h2>Buscar recetas</h2>
        {keyStatus && !keyStatus.configured ? (
          <p className="muted">
            Configurá tu API key de recipeapi.io para buscar recetas.{" "}
            <button className="link" onClick={() => setShowKey(true)}>
              Configurar
            </button>
          </p>
        ) : (
          <>
            <div className="chips presets">
              {PRESETS.map((p, i) => (
                <button key={p.name} type="button" className={`pill ${activePreset === i ? "on" : ""}`} onClick={() => applyPreset(i)} disabled={searching}>
                  {p.name}
                </button>
              ))}
            </div>
            <form className="rfilters" onSubmit={searchRecipes}>
              <div className="inline-form">
                <input className="field" placeholder="Buscar por nombre (en inglés)…" value={rq.search} onChange={setF("search")} />
                <input type="number" min="0" className="field narrow" title="Calorías máximas por porción" placeholder="kcal máx." value={rq.calories_per_serving_max} onChange={setF("calories_per_serving_max")} />
                <input type="number" min="0" className="field narrow" title="Proteína mínima (g) por porción" placeholder="Prot. mín. (g)" value={rq.protein_min} onChange={setF("protein_min")} />
                <button className="pill solid" disabled={searching}>
                  {searching ? "Buscando…" : "Buscar"}
                </button>
                <button type="button" className="pill" onClick={() => setShowAdv(!showAdv)}>
                  {showAdv ? "Menos filtros" : "Más filtros"}
                </button>
              </div>
              {showAdv && (
                <div className="adv">
                  <label>Tipo de comida
                    <select className="pill" value={rq.meal_type} onChange={setF("meal_type")}>
                      <option value="">Cualquiera</option>
                      {MEAL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label>Cocina
                    <select className="pill" value={rq.cuisine} onChange={setF("cuisine")}>
                      <option value="">Cualquiera</option>
                      {CUISINES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label>Dieta
                    <select className="pill" value={rq.dietary_tags} onChange={setF("dietary_tags")}>
                      <option value="">Cualquiera</option>
                      {DIETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label>Dificultad
                    <select className="pill" value={rq.difficulty} onChange={setF("difficulty")}>
                      <option value="">Cualquiera</option>
                      {DIFFICULTIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label>Ingredientes (en inglés, separados por coma)
                    <input className="field" placeholder="chicken, broccoli" value={rq.ingredients} onChange={setF("ingredients")} />
                  </label>
                  <label>Preparación máx. (min)
                    <input type="number" min="0" className="field" value={rq.prep_time_max} onChange={setF("prep_time_max")} />
                  </label>
                  <label>Cocción máx. (min)
                    <input type="number" min="0" className="field" value={rq.cook_time_max} onChange={setF("cook_time_max")} />
                  </label>
                  <label>Ordenar por
                    <select className="pill" value={rq.sort} onChange={setF("sort")}>
                      {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label>Orden
                    <select className="pill" value={rq.order} onChange={setF("order")}>
                      <option value="desc">Mayor a menor</option>
                      <option value="asc">Menor a mayor</option>
                    </select>
                  </label>
                  <button type="button" className="link" onClick={() => { setRq(EMPTY_FILTERS); setActivePreset(null); }}>
                    Limpiar filtros
                  </button>
                </div>
              )}
            </form>
            {recipes && recipes.length === 0 && <div className="empty">Sin resultados con esos filtros.</div>}
            {recipes && recipes.length > 0 && (
              <div className="table-card">
                {recipes.map((r) => (
                  <div key={r.id} className="trow recipe-row">
                    <div>
                      {r.name}
                      <span className="sub">
                        {r.calories_per_serving} kcal · {r.protein} g prot · {label(MEAL_TYPES, r.meal_type)}{r.prep_time ? ` · ${r.prep_time} min` : ""}
                      </span>
                    </div>
                    <button className="pill" onClick={() => useRecipe(r)}>
                      Agregar al calendario
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {showKey && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setShowKey(false)}>
          <form className="modal" onSubmit={saveKey}>
            <h2>API de recetas</h2>
            <p className="muted">
              Pegá tu API key de{" "}
              <a className="link" href="https://recipeapi.io" target="_blank" rel="noreferrer">
                recipeapi.io
              </a>{" "}
              (empieza con <code>sk_live_</code>). Se guarda en el servidor y no se vuelve a mostrar.
            </p>
            {keyStatus?.configured && <p className="muted">Key actual: {keyStatus.preview}</p>}
            <input
              className="field"
              type="password"
              autoFocus
              autoComplete="off"
              placeholder="sk_live_…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <div className="modal-actions">
              {keyStatus?.configured && (
                <button type="button" className="pill danger" onClick={removeKey}>
                  Quitar key
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" className="pill" onClick={() => setShowKey(false)}>
                Cancelar
              </button>
              <button className="pill solid" disabled={!keyInput.trim()}>
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}

      {modal && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <form className="modal" onSubmit={save}>
            <h2>{modal.id ? "Editar comida" : "Nueva comida"}</h2>
            <label>
              Qué se come
              <input
                className="field"
                autoFocus
                placeholder="Ej: Milanesas con ensalada"
                value={modal.title}
                onChange={set("title")}
                maxLength={200}
              />
            </label>
            <div className="row2">
              <label>
                Día
                <input type="date" className="pill" value={modal.date} onChange={set("date")} required />
              </label>
              <label>
                Momento
                <select className="pill" value={modal.slot} onChange={set("slot")}>
                  {SLOTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Notas
              <textarea className="field area" rows={3} value={modal.notes} onChange={set("notes")} placeholder="Ingredientes, receta, etc." />
            </label>
            <div className="modal-actions">
              {modal.id && (
                <button type="button" className="pill danger" onClick={() => remove(modal.id)}>
                  Eliminar
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" className="pill" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button className="pill solid" disabled={!modal.title.trim() || !modal.date}>
                {modal.id ? "Guardar" : "Agregar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function WeekRow({ slot, label, icon, days, todayIso, byCell, setModal }) {
  return (
    <>
      <div className="week-slot">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      {days.map((d) => {
        const date = iso(d);
        const items = byCell[`${date}|${slot}`] || [];
        return (
          <div key={date} className={`week-cell ${date === todayIso ? "today" : ""}`}>
            {items.map((m) => (
              <button key={m.id} className="meal" title={m.notes || m.title} onClick={() => setModal({ ...m })}>
                {m.title}
              </button>
            ))}
            <button
              className="meal-add"
              aria-label={`Agregar ${label} el ${date}`}
              onClick={() => setModal({ date, slot, title: "", notes: "" })}
            >
              +
            </button>
          </div>
        );
      })}
    </>
  );
}
