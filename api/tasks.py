from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, Field

from db import pool

router = APIRouter(prefix="/tasks", tags=["tasks"])

Priority = Literal["low", "medium", "high"]
MEMBER_COLORS = [
    "#ff37c7",
    "#4c82fb",
    "#21c95e",
    "#ffb020",
    "#9b5cff",
    "#00c2d1",
    "#ff6b4a",
    "#8b8b8b",
]


# ---------- models ----------
class MemberIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class Member(MemberIn):
    id: int
    color: str


class ColumnIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    is_done: bool = False


class Column(ColumnIn):
    id: int
    position: int


class OrderIn(BaseModel):
    ids: list[int]


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    column_id: int
    priority: Priority = "medium"
    assignee_id: int | None = None
    due_date: date | None = None


class ColumnMoveIn(BaseModel):
    column_id: int


class Task(TaskIn):
    id: int
    assignee: str | None
    assignee_color: str | None


TASK_SELECT = """
SELECT t.id, t.title, t.description, t.column_id, t.priority, t.assignee_id,
       t.due_date, m.name AS assignee, m.color AS assignee_color
FROM tasks t
LEFT JOIN task_members m ON m.id = t.assignee_id
"""


def check_assignee(conn, assignee_id: int | None) -> None:
    if assignee_id is None:
        return
    if not conn.execute(
        "SELECT 1 FROM task_members WHERE id = %s", (assignee_id,)
    ).fetchone():
        raise HTTPException(422, "Responsable inexistente")


def check_column(conn, column_id: int) -> None:
    if not conn.execute("SELECT 1 FROM task_columns WHERE id = %s", (column_id,)).fetchone():
        raise HTTPException(422, "Columna inexistente")


def get_task(conn, task_id: int) -> dict:
    row = conn.execute(TASK_SELECT + "WHERE t.id = %s", (task_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Tarea no encontrada")
    return row


# ---------- members ----------
@router.get("/members", response_model=list[Member])
def list_members():
    with pool.connection() as conn:
        return conn.execute("SELECT id, name, color FROM task_members ORDER BY id").fetchall()


@router.post("/members", response_model=Member, status_code=201)
def create_member(body: MemberIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Nombre vacío")
    with pool.connection() as conn:
        n = conn.execute("SELECT count(*) AS n FROM task_members").fetchone()["n"]
        try:
            return conn.execute(
                "INSERT INTO task_members (name, color) VALUES (%s, %s) "
                "RETURNING id, name, color",
                (name, MEMBER_COLORS[n % len(MEMBER_COLORS)]),
            ).fetchone()
        except UniqueViolation:
            raise HTTPException(409, "Ya existe un responsable con ese nombre")


@router.delete("/members/{member_id}", status_code=204)
def delete_member(member_id: int):
    with pool.connection() as conn:
        cur = conn.execute("DELETE FROM task_members WHERE id = %s", (member_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Responsable no encontrado")


# ---------- columns ----------
COLUMN_SELECT = "SELECT id, name, position, is_done FROM task_columns "


@router.get("/columns", response_model=list[Column])
def list_columns():
    with pool.connection() as conn:
        return conn.execute(COLUMN_SELECT + "ORDER BY position, id").fetchall()


@router.post("/columns", response_model=Column, status_code=201)
def create_column(body: ColumnIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Nombre vacío")
    with pool.connection() as conn:
        return conn.execute(
            "INSERT INTO task_columns (name, position, is_done) VALUES (%s, "
            "(SELECT COALESCE(MAX(position), -1) + 1 FROM task_columns), %s) "
            "RETURNING id, name, position, is_done",
            (name, body.is_done),
        ).fetchone()


@router.put("/columns/order", response_model=list[Column])
def reorder_columns(body: OrderIn):
    with pool.connection() as conn:
        existing = {r["id"] for r in conn.execute("SELECT id FROM task_columns").fetchall()}
        if set(body.ids) != existing or len(body.ids) != len(existing):
            raise HTTPException(422, "La lista de columnas no coincide")
        for pos, cid in enumerate(body.ids):
            conn.execute("UPDATE task_columns SET position = %s WHERE id = %s", (pos, cid))
        return conn.execute(COLUMN_SELECT + "ORDER BY position, id").fetchall()


@router.put("/columns/{column_id}", response_model=Column)
def update_column(column_id: int, body: ColumnIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Nombre vacío")
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE task_columns SET name = %s, is_done = %s WHERE id = %s "
            "RETURNING id, name, position, is_done",
            (name, body.is_done, column_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Columna no encontrada")
        return row


@router.delete("/columns/{column_id}", status_code=204)
def delete_column(column_id: int):
    """Elimina la columna; sus tareas pasan a la primera columna restante."""
    with pool.connection() as conn:
        target = conn.execute(
            "SELECT id FROM task_columns WHERE id <> %s ORDER BY position, id LIMIT 1",
            (column_id,),
        ).fetchone()
        if not target:
            raise HTTPException(409, "Tiene que quedar al menos una columna")
        conn.execute(
            "UPDATE tasks SET column_id = %s WHERE column_id = %s", (target["id"], column_id)
        )
        cur = conn.execute("DELETE FROM task_columns WHERE id = %s", (column_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Columna no encontrada")


# ---------- tasks ----------
@router.get("", response_model=list[Task])
def list_tasks():
    with pool.connection() as conn:
        return conn.execute(TASK_SELECT + "ORDER BY t.created_at DESC, t.id DESC").fetchall()


@router.post("", response_model=Task, status_code=201)
def create_task(body: TaskIn):
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "Título vacío")
    with pool.connection() as conn:
        check_assignee(conn, body.assignee_id)
        check_column(conn, body.column_id)
        new_id = conn.execute(
            "INSERT INTO tasks (title, description, column_id, priority, assignee_id, due_date) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (title, body.description, body.column_id, body.priority, body.assignee_id, body.due_date),
        ).fetchone()["id"]
        return get_task(conn, new_id)


@router.put("/{task_id}", response_model=Task)
def update_task(task_id: int, body: TaskIn):
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "Título vacío")
    with pool.connection() as conn:
        check_assignee(conn, body.assignee_id)
        check_column(conn, body.column_id)
        cur = conn.execute(
            "UPDATE tasks SET title=%s, description=%s, column_id=%s, priority=%s, "
            "assignee_id=%s, due_date=%s WHERE id=%s",
            (title, body.description, body.column_id, body.priority,
             body.assignee_id, body.due_date, task_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Tarea no encontrada")
        return get_task(conn, task_id)


@router.patch("/{task_id}/column", response_model=Task)
def move_task(task_id: int, body: ColumnMoveIn):
    with pool.connection() as conn:
        check_column(conn, body.column_id)
        cur = conn.execute("UPDATE tasks SET column_id=%s WHERE id=%s", (body.column_id, task_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "Tarea no encontrada")
        return get_task(conn, task_id)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int):
    with pool.connection() as conn:
        cur = conn.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Tarea no encontrada")
