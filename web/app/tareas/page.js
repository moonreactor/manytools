"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Avatar from "../../components/Avatar";
import { api } from "../../lib/api";

const COLUMN_COLORS = ["#9b9b9b", "#4c82fb", "#ffb020", "#9b5cff", "#00c2d1", "#ff6b4a", "#ff37c7", "#21c95e"];
const PRIORITIES = [
  ["high", "Alta"],
  ["medium", "Media"],
  ["low", "Baja"],
];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const priorityLabel = Object.fromEntries(PRIORITIES);

const today = () => new Date().toLocaleDateString("sv-SE");
const emptyForm = (column_id = "") => ({
  title: "",
  description: "",
  column_id,
  priority: "medium",
  assignee_id: "",
  due_date: "",
});

function formatDue(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("es", { day: "numeric", month: "short" });
}

const isOverdue = (t) => t.due_date && !t.done && t.due_date < today();

function PriorityBadge({ value }) {
  return <span className={`prio prio-${value}`}>{priorityLabel[value]}</span>;
}

function Due({ task }) {
  if (!task.due_date) return <span className="muted">—</span>;
  return (
    <span className={isOverdue(task) ? "neg" : task.due_date === today() ? "due-today" : ""}>
      {formatDue(task.due_date)}
    </span>
  );
}

function Assignee({ task }) {
  if (!task.assignee) return <span className="muted">Sin asignar</span>;
  return (
    <span className="who">
      <Avatar name={task.assignee} color={task.assignee_color} size={22} />
      {task.assignee}
    </span>
  );
}

export default function Tareas() {
  const [view, setView] = useState("list");
  const [rawTasks, setRawTasks] = useState([]);
  const [columns, setColumns] = useState([]);
  const [colMenu, setColMenu] = useState(null); // id de la columna con menú abierto
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [newCol, setNewCol] = useState(null); // null | string
  const [members, setMembers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [who, setWho] = useState(""); // "" todos, "none" sin asignar, id
  const [prio, setPrio] = useState("");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(null); // { id?, ...form }
  const [showPeople, setShowPeople] = useState(false);
  const [newMember, setNewMember] = useState("");
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem("tareas.view");
      if (v === "list" || v === "board") setView(v);
    } catch {}
  }, []);

  const changeView = (v) => {
    setView(v);
    try {
      localStorage.setItem("tareas.view", v);
    } catch {}
  };

  const load = useCallback(async () => {
    try {
      const [t, m, c] = await Promise.all([api("/tasks"), api("/tasks/members"), api("/tasks/columns")]);
      setRawTasks(t);
      setMembers(m);
      setColumns(c);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doneIds = useMemo(() => new Set(columns.filter((c) => c.is_done).map((c) => c.id)), [columns]);
  const tasks = useMemo(() => rawTasks.map((t) => ({ ...t, done: doneIds.has(t.column_id) })), [rawTasks, doneIds]);
  const colIndex = useMemo(() => Object.fromEntries(columns.map((c, i) => [c.id, i])), [columns]);
  const colColor = (id) => COLUMN_COLORS[(colIndex[id] ?? 0) % COLUMN_COLORS.length];
  const firstOpen = columns.find((c) => !c.is_done) ?? columns[0];
  const firstDone = columns.find((c) => c.is_done);

  const run = async (fn) => {
    try {
      await fn();
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter((t) => (who === "" ? true : who === "none" ? !t.assignee_id : t.assignee_id === Number(who)))
      .filter((t) => (prio ? t.priority === prio : true))
      .filter((t) => (q ? (t.title + " " + t.description).toLowerCase().includes(q) : true))
      .sort(
        (a, b) =>
          a.done - b.done ||
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
          b.id - a.id
      );
  }, [tasks, who, prio, query]);

  const stats = useMemo(
    () => ({
      open: tasks.filter((t) => !t.done).length,
      overdue: tasks.filter(isOverdue).length,
      done: tasks.filter((t) => t.done).length,
    }),
    [tasks]
  );

  const openNew = (columnId = firstOpen?.id ?? "") =>
    setModal({ ...emptyForm(columnId), assignee_id: who && who !== "none" ? who : "" });
  const openEdit = (t) =>
    setModal({
      id: t.id,
      title: t.title,
      description: t.description,
      column_id: t.column_id,
      priority: t.priority,
      assignee_id: t.assignee_id ?? "",
      due_date: t.due_date ?? "",
    });

  const save = (e) =>
    e.preventDefault() ||
    run(async () => {
      const { id, ...f } = modal;
      const body = {
        ...f,
        column_id: Number(f.column_id),
        assignee_id: f.assignee_id === "" ? null : Number(f.assignee_id),
        due_date: f.due_date || null,
      };
      if (id) await api(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/tasks", { method: "POST", body: JSON.stringify(body) });
      setModal(null);
      await load();
    });

  const remove = (id) =>
    run(async () => {
      if (!confirm("¿Eliminar esta tarea?")) return;
      await api(`/tasks/${id}`, { method: "DELETE" });
      setModal(null);
      await load();
    });

  const moveTask = (id, column_id) => {
    const t = rawTasks.find((x) => x.id === id);
    if (!t || t.column_id === column_id) return;
    const prev = rawTasks;
    setRawTasks((ts) => ts.map((x) => (x.id === id ? { ...x, column_id } : x))); // optimista
    api(`/tasks/${id}/column`, { method: "PATCH", body: JSON.stringify({ column_id }) }).catch((e) => {
      setRawTasks(prev);
      setError(e.message);
    });
  };

  // ----- columnas -----
  const addColumn = (e) => {
    e.preventDefault();
    const name = (newCol || "").trim();
    if (!name) return;
    run(async () => {
      await api("/tasks/columns", { method: "POST", body: JSON.stringify({ name }) });
      setNewCol(null);
      await load();
    });
  };

  const saveColumn = (c, patch) =>
    run(async () => {
      await api(`/tasks/columns/${c.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: c.name, is_done: c.is_done, ...patch }),
      });
      await load();
    });

  const submitRename = (e) => {
    e.preventDefault();
    const c = columns.find((x) => x.id === renaming.id);
    const name = renaming.name.trim();
    setRenaming(null);
    if (c && name && name !== c.name) saveColumn(c, { name });
  };

  const moveColumn = (id, dir) =>
    run(async () => {
      const ids = columns.map((c) => c.id);
      const i = ids.indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      setColumns(ids.map((x) => columns.find((c) => c.id === x))); // optimista
      await api("/tasks/columns/order", { method: "PUT", body: JSON.stringify({ ids }) });
      await load();
    });

  const removeColumn = (c) =>
    run(async () => {
      const n = tasks.filter((t) => t.column_id === c.id).length;
      const dest = columns.find((x) => x.id !== c.id);
      const msg = n
        ? `¿Eliminar "${c.name}"? Sus ${n} tareas pasarán a "${dest?.name}".`
        : `¿Eliminar la columna "${c.name}"?`;
      if (!confirm(msg)) return;
      await api(`/tasks/columns/${c.id}`, { method: "DELETE" });
      await load();
    });

  const addMember = (e) => {
    e.preventDefault();
    if (!newMember.trim()) return;
    run(async () => {
      await api("/tasks/members", { method: "POST", body: JSON.stringify({ name: newMember }) });
      setNewMember("");
      await load();
    });
  };

  const removeMember = (m) =>
    run(async () => {
      if (!confirm(`¿Eliminar a ${m.name}? Sus tareas quedarán sin asignar.`)) return;
      await api(`/tasks/members/${m.id}`, { method: "DELETE" });
      if (who === String(m.id)) setWho("");
      await load();
    });

  const set = (k) => (e) => setModal((m) => ({ ...m, [k]: e.target.value }));

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="title">Tareas</h1>
          <div className="deltas muted">
            <span>{stats.open} abiertas</span>
            <span className={stats.overdue ? "neg" : ""}>{stats.overdue} vencidas</span>
            <span>{stats.done} hechas</span>
          </div>
        </div>
        <button className="pill solid" onClick={() => openNew()}>
          + Nueva tarea
        </button>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="toolbar">
        <div className="tabs-pill seg">
          <button className={view === "list" ? "on" : ""} onClick={() => changeView("list")}>
            ☰ Lista
          </button>
          <button className={view === "board" ? "on" : ""} onClick={() => changeView("board")}>
            ▥ Tablero
          </button>
        </div>
        <input
          className="field search"
          placeholder="Buscar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="pill" value={prio} onChange={(e) => setPrio(e.target.value)}>
          <option value="">Toda prioridad</option>
          {PRIORITIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="filters tfilters">
        <button className={`pill ${who === "" ? "on" : ""}`} onClick={() => setWho("")}>
          Todos
        </button>
        {members.map((m) => (
          <button
            key={m.id}
            className={`pill ${who === String(m.id) ? "on" : ""}`}
            onClick={() => setWho(who === String(m.id) ? "" : String(m.id))}
          >
            <Avatar name={m.name} color={m.color} size={18} /> {m.name}
          </button>
        ))}
        <button className={`pill ${who === "none" ? "on" : ""}`} onClick={() => setWho(who === "none" ? "" : "none")}>
          Sin asignar
        </button>
        <button className="link" onClick={() => setShowPeople((s) => !s)}>
          {showPeople ? "Cerrar" : "Gestionar responsables"}
        </button>
      </div>

      {showPeople && (
        <div className="table-card pad people-panel">
          <form className="inline-form" onSubmit={addMember}>
            <input
              className="field"
              placeholder="Nombre del responsable"
              maxLength={50}
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
            />
            <button className="pill solid" disabled={!newMember.trim()}>
              Agregar
            </button>
          </form>
          {members.length === 0 ? (
            <p className="muted">Todavía no hay responsables.</p>
          ) : (
            <div className="chips">
              {members.map((m) => (
                <span className="chip" key={m.id}>
                  <Avatar name={m.name} color={m.color} size={18} /> {m.name}
                  <button title="Eliminar" onClick={() => removeMember(m)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {!loaded ? (
        <div className="empty">Cargando…</div>
      ) : view === "list" ? (
        <div className="table-card">
          <div className="thead tasks-row">
            <span />
            <span>Tarea</span>
            <span>Prioridad</span>
            <span>Responsable</span>
            <span>Vence</span>
            <span>Estado</span>
          </div>
          {visible.length === 0 && (
            <div className="empty">{tasks.length ? "Ninguna tarea coincide con los filtros." : "No hay tareas. ¡Creá la primera!"}</div>
          )}
          {visible.map((t) => (
            <div key={t.id} className={`trow tasks-row ${t.done ? "is-done" : ""}`}>
              <input
                type="checkbox"
                className="check"
                checked={t.done}
                title={t.done ? "Reabrir" : "Marcar como hecha"}
                disabled={t.done ? !firstOpen || firstOpen.is_done : !firstDone}
                onChange={() => moveTask(t.id, (t.done ? firstOpen : firstDone).id)}
              />
              <button className="task-title" onClick={() => openEdit(t)}>
                <span className="t">{t.title}</span>
                {t.description && <span className="sub clamp">{t.description}</span>}
              </button>
              <span>
                <PriorityBadge value={t.priority} />
              </span>
              <Assignee task={t} />
              <Due task={t} />
              <select
                className="pill status-sel"
                style={{ backgroundColor: `color-mix(in srgb, ${colColor(t.column_id)} 18%, transparent)` }}
                value={t.column_id}
                onChange={(e) => moveTask(t.id, Number(e.target.value))}
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      ) : (
        <div className="board">
          {columns.map((c, idx) => {
            const col = visible.filter((t) => t.column_id === c.id);
            return (
              <section
                key={c.id}
                className={`col ${overCol === c.id ? "over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(c.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverCol(null);
                  const id = Number(e.dataTransfer.getData("text/plain")) || dragId;
                  if (id) moveTask(id, c.id);
                  setDragId(null);
                }}
              >
                <header className="col-head">
                  <span className="dot" style={{ background: colColor(c.id) }} />
                  {renaming?.id === c.id ? (
                    <form onSubmit={submitRename} className="rename">
                      <input
                        className="field"
                        autoFocus
                        maxLength={40}
                        value={renaming.name}
                        onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                        onBlur={submitRename}
                        onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                      />
                    </form>
                  ) : (
                    <h2 onDoubleClick={() => setRenaming({ id: c.id, name: c.name })} title="Doble click para renombrar">
                      {c.name}
                    </h2>
                  )}
                  {c.is_done && <span className="done-mark" title="Las tareas de esta columna cuentan como terminadas">✓</span>}
                  <span className="count">{col.length}</span>
                  <button className="icon add" title="Agregar tarea" onClick={() => openNew(c.id)}>
                    +
                  </button>
                  <div className="menu-wrap">
                    <button className="icon add" title="Opciones de columna" onClick={() => setColMenu(colMenu === c.id ? null : c.id)}>
                      ⋯
                    </button>
                    {colMenu === c.id && (
                      <>
                        <div className="menu-backdrop" onClick={() => setColMenu(null)} />
                        <div className="menu">
                          <button
                            onClick={() => {
                              setColMenu(null);
                              setRenaming({ id: c.id, name: c.name });
                            }}
                          >
                            Renombrar
                          </button>
                          <button
                            disabled={idx === 0}
                            onClick={() => {
                              setColMenu(null);
                              moveColumn(c.id, -1);
                            }}
                          >
                            ← Mover a la izquierda
                          </button>
                          <button
                            disabled={idx === columns.length - 1}
                            onClick={() => {
                              setColMenu(null);
                              moveColumn(c.id, 1);
                            }}
                          >
                            Mover a la derecha →
                          </button>
                          <button
                            onClick={() => {
                              setColMenu(null);
                              saveColumn(c, { is_done: !c.is_done });
                            }}
                          >
                            {c.is_done ? "☑" : "☐"} Cuenta como terminada
                          </button>
                          <button
                            className="danger"
                            disabled={columns.length < 2}
                            onClick={() => {
                              setColMenu(null);
                              removeColumn(c);
                            }}
                          >
                            Eliminar columna
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </header>
                <div className="col-body">
                  {col.map((t) => (
                    <article
                      key={t.id}
                      draggable
                      className={`kcard ${dragId === t.id ? "dragging" : ""} ${t.done ? "is-done" : ""}`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(t.id));
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(t.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                      onClick={() => openEdit(t)}
                    >
                      <div className="kcard-top">
                        <PriorityBadge value={t.priority} />
                        {t.due_date && (
                          <span className="kdue">
                            📅 <Due task={t} />
                          </span>
                        )}
                      </div>
                      <h3>{t.title}</h3>
                      {t.description && <p className="muted clamp">{t.description}</p>}
                      <footer>
                        <Assignee task={t} />
                      </footer>
                    </article>
                  ))}
                  {col.length === 0 && <div className="col-empty">Soltá una tarea acá</div>}
                </div>
              </section>
            );
          })}
          <div className="col col-new">
            {newCol === null ? (
              <button className="link" onClick={() => setNewCol("")}>
                + Nueva columna
              </button>
            ) : (
              <form onSubmit={addColumn} className="rename">
                <input
                  className="field"
                  autoFocus
                  maxLength={40}
                  placeholder="Nombre de la columna"
                  value={newCol}
                  onChange={(e) => setNewCol(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setNewCol(null)}
                />
                <div className="modal-actions">
                  <button className="pill solid" disabled={!newCol.trim()}>
                    Agregar
                  </button>
                  <button type="button" className="pill" onClick={() => setNewCol(null)}>
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {modal && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <form className="modal" onSubmit={save}>
            <h2>{modal.id ? "Editar tarea" : "Nueva tarea"}</h2>
            <label>
              Título
              <input
                className="field"
                autoFocus
                required
                maxLength={200}
                value={modal.title}
                onChange={set("title")}
                placeholder="¿Qué hay que hacer?"
              />
            </label>
            <label>
              Descripción
              <textarea
                className="field area"
                rows={4}
                maxLength={5000}
                value={modal.description}
                onChange={set("description")}
                placeholder="Detalles, links, contexto…"
              />
            </label>
            <div className="row2">
              <label>
                Prioridad
                <select className="pill" value={modal.priority} onChange={set("priority")}>
                  {PRIORITIES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Estado
                <select className="pill" value={modal.column_id} onChange={set("column_id")} required>
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Responsable
                <select className="pill" value={modal.assignee_id} onChange={set("assignee_id")}>
                  <option value="">Sin asignar</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Vencimiento
                <input type="date" className="pill" value={modal.due_date} onChange={set("due_date")} />
              </label>
            </div>
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
              <button className="pill solid" disabled={!modal.title.trim() || !modal.column_id}>
                {modal.id ? "Guardar" : "Crear"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
