from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, Field

from db import pool

router = APIRouter(prefix="/finance", tags=["finance"])

TxType = Literal["income", "expense"]
MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"
PROFILE_COLORS = [
    "#ff37c7",
    "#4c82fb",
    "#21c95e",
    "#ffb020",
    "#9b5cff",
    "#00c2d1",
    "#ff6b4a",
    "#8b8b8b",
]
NO_PROFILE_COLOR = "#9b9b9b"


# ---------- models ----------
class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    type: TxType


class Category(CategoryIn):
    id: int


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class Profile(ProfileIn):
    id: int
    color: str


class TransactionIn(BaseModel):
    type: TxType
    amount: float = Field(gt=0, lt=1e12)
    category_id: int | None = None
    profile_id: int | None = None
    description: str = Field(default="", max_length=200)
    date: date


class Transaction(BaseModel):
    id: int
    type: TxType
    amount: float
    category_id: int | None
    category: str | None
    profile_id: int | None
    profile: str | None
    profile_color: str | None
    description: str
    date: date


class CategoryTotal(BaseModel):
    category: str
    total: float


class ProfileTotal(BaseModel):
    id: int | None
    name: str
    color: str
    income: float
    expense: float


class Summary(BaseModel):
    month: str
    income: float
    expense: float
    balance: float
    expenses_by_category: list[CategoryTotal]
    by_profile: list[ProfileTotal]


class BiggestExpense(BaseModel):
    description: str
    category: str | None
    amount: float
    date: date


class MonthTotals(BaseModel):
    month: str
    income: float
    expense: float


class Metrics(BaseModel):
    month: str
    tx_count: int
    savings_rate: float | None
    avg_daily_expense: float
    projected_expense: float | None
    biggest_expense: BiggestExpense | None
    previous: MonthTotals
    trend: list[MonthTotals]


# ---------- helpers ----------
def month_range(month: str) -> tuple[date, date]:
    year, mon = int(month[:4]), int(month[5:7])
    start = date(year, mon, 1)
    end = date(year + (mon == 12), mon % 12 + 1, 1)
    return start, end


def shift_month(d: date, n: int) -> date:
    idx = d.year * 12 + (d.month - 1) + n
    return date(idx // 12, idx % 12 + 1, 1)


def profile_filter(profile_id: int | None) -> tuple[str, tuple]:
    """Fragmento SQL opcional para filtrar por perfil (columna sin alias)."""
    if profile_id is None:
        return "", ()
    return " AND profile_id = %s", (profile_id,)


# ---------- categories ----------
@router.get("/categories", response_model=list[Category])
def list_categories():
    with pool.connection() as conn:
        return conn.execute(
            "SELECT id, name, type FROM fin_categories ORDER BY type, name"
        ).fetchall()


@router.post("/categories", response_model=Category, status_code=201)
def create_category(body: CategoryIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "El nombre no puede estar vacío")
    try:
        with pool.connection() as conn:
            return conn.execute(
                "INSERT INTO fin_categories (name, type) VALUES (%s, %s) "
                "RETURNING id, name, type",
                (name, body.type),
            ).fetchone()
    except UniqueViolation:
        raise HTTPException(409, "Esa categoría ya existe")


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int):
    with pool.connection() as conn:
        cur = conn.execute("DELETE FROM fin_categories WHERE id = %s", (category_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Categoría no encontrada")


# ---------- profiles ----------
@router.get("/profiles", response_model=list[Profile])
def list_profiles():
    with pool.connection() as conn:
        return conn.execute(
            "SELECT id, name, color FROM fin_profiles ORDER BY id"
        ).fetchall()


@router.post("/profiles", response_model=Profile, status_code=201)
def create_profile(body: ProfileIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "El nombre no puede estar vacío")
    try:
        with pool.connection() as conn:
            n = conn.execute("SELECT count(*) AS n FROM fin_profiles").fetchone()["n"]
            return conn.execute(
                "INSERT INTO fin_profiles (name, color) VALUES (%s, %s) "
                "RETURNING id, name, color",
                (name, PROFILE_COLORS[n % len(PROFILE_COLORS)]),
            ).fetchone()
    except UniqueViolation:
        raise HTTPException(409, "Ese perfil ya existe")


@router.delete("/profiles/{profile_id}", status_code=204)
def delete_profile(profile_id: int):
    with pool.connection() as conn:
        cur = conn.execute("DELETE FROM fin_profiles WHERE id = %s", (profile_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Perfil no encontrado")


# ---------- transactions ----------
TX_SELECT = """
SELECT t.id, t.type, t.amount, t.category_id, c.name AS category,
       t.profile_id, p.name AS profile, p.color AS profile_color,
       t.description, t.date
FROM fin_transactions t
LEFT JOIN fin_categories c ON c.id = t.category_id
LEFT JOIN fin_profiles p ON p.id = t.profile_id
"""


@router.get("/transactions", response_model=list[Transaction])
def list_transactions(
    month: str = Query(pattern=MONTH_PATTERN), profile_id: int | None = None
):
    start, end = month_range(month)
    pf_sql, pf_args = profile_filter(profile_id)
    with pool.connection() as conn:
        return conn.execute(
            TX_SELECT
            + "WHERE t.date >= %s AND t.date < %s"
            + pf_sql
            + " ORDER BY t.date DESC, t.id DESC",
            (start, end, *pf_args),
        ).fetchall()


@router.post("/transactions", response_model=Transaction, status_code=201)
def create_transaction(body: TransactionIn):
    with pool.connection() as conn:
        if body.category_id is not None:
            cat = conn.execute(
                "SELECT type FROM fin_categories WHERE id = %s", (body.category_id,)
            ).fetchone()
            if cat is None:
                raise HTTPException(400, "Categoría inexistente")
            if cat["type"] != body.type:
                raise HTTPException(400, "La categoría no corresponde al tipo")
        if body.profile_id is not None:
            prof = conn.execute(
                "SELECT 1 FROM fin_profiles WHERE id = %s", (body.profile_id,)
            ).fetchone()
            if prof is None:
                raise HTTPException(400, "Perfil inexistente")
        new = conn.execute(
            "INSERT INTO fin_transactions "
            "(type, amount, category_id, profile_id, description, date) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.type,
                body.amount,
                body.category_id,
                body.profile_id,
                body.description.strip(),
                body.date,
            ),
        ).fetchone()
        return conn.execute(TX_SELECT + "WHERE t.id = %s", (new["id"],)).fetchone()


@router.delete("/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int):
    with pool.connection() as conn:
        cur = conn.execute(
            "DELETE FROM fin_transactions WHERE id = %s", (transaction_id,)
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Movimiento no encontrado")


# ---------- summary ----------
@router.get("/summary", response_model=Summary)
def summary(month: str = Query(pattern=MONTH_PATTERN), profile_id: int | None = None):
    start, end = month_range(month)
    pf_sql, pf_args = profile_filter(profile_id)
    with pool.connection() as conn:
        totals = conn.execute(
            "SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income, "
            "COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense "
            "FROM fin_transactions WHERE date >= %s AND date < %s" + pf_sql,
            (start, end, *pf_args),
        ).fetchone()
        by_cat = conn.execute(
            "SELECT COALESCE(c.name, 'Sin categoría') AS category, SUM(t.amount) AS total "
            "FROM fin_transactions t LEFT JOIN fin_categories c ON c.id = t.category_id "
            "WHERE t.type = 'expense' AND t.date >= %s AND t.date < %s"
            + pf_sql
            + " GROUP BY 1 ORDER BY total DESC",
            (start, end, *pf_args),
        ).fetchall()
        # Totales por perfil: siempre de todos los perfiles, sin filtrar.
        by_profile = conn.execute(
            "SELECT p.id, p.name, p.color, "
            "COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0) AS income, "
            "COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS expense "
            "FROM fin_profiles p LEFT JOIN fin_transactions t "
            "ON t.profile_id = p.id AND t.date >= %s AND t.date < %s "
            "GROUP BY p.id ORDER BY p.id",
            (start, end),
        ).fetchall()
        unassigned = conn.execute(
            "SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income, "
            "COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense "
            "FROM fin_transactions WHERE profile_id IS NULL AND date >= %s AND date < %s",
            (start, end),
        ).fetchone()
    if by_profile and (unassigned["income"] or unassigned["expense"]):
        by_profile.append(
            {
                "id": None,
                "name": "Sin perfil",
                "color": NO_PROFILE_COLOR,
                **unassigned,
            }
        )
    return {
        "month": month,
        "income": totals["income"],
        "expense": totals["expense"],
        "balance": totals["income"] - totals["expense"],
        "expenses_by_category": by_cat,
        "by_profile": by_profile,
    }


# ---------- metrics ----------
@router.get("/metrics", response_model=Metrics)
def metrics(
    month: str = Query(pattern=MONTH_PATTERN),
    today: date | None = None,
    profile_id: int | None = None,
):
    today = today or date.today()
    start, end = month_range(month)
    days_in_month = (end - start).days
    pf_sql, pf_args = profile_filter(profile_id)

    if today >= end:
        elapsed, is_current = days_in_month, False
    elif today >= start:
        elapsed, is_current = today.day, True
    else:
        elapsed, is_current = 0, False

    trend_start = shift_month(start, -5)
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT to_char(date, 'YYYY-MM') AS month, "
            "COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income, "
            "COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense "
            "FROM fin_transactions WHERE date >= %s AND date < %s"
            + pf_sql
            + " GROUP BY 1",
            (trend_start, end, *pf_args),
        ).fetchall()
        biggest = conn.execute(
            TX_SELECT
            + "WHERE t.type = 'expense' AND t.date >= %s AND t.date < %s"
            + pf_sql
            + " ORDER BY t.amount DESC, t.id DESC LIMIT 1",
            (start, end, *pf_args),
        ).fetchone()
        tx_count = conn.execute(
            "SELECT count(*) AS n FROM fin_transactions "
            "WHERE date >= %s AND date < %s" + pf_sql,
            (start, end, *pf_args),
        ).fetchone()["n"]

    by_month = {r["month"]: r for r in rows}
    trend = []
    for i in range(6):
        m = shift_month(trend_start, i).strftime("%Y-%m")
        r = by_month.get(m)
        trend.append(
            {
                "month": m,
                "income": r["income"] if r else 0,
                "expense": r["expense"] if r else 0,
            }
        )

    current, previous = trend[-1], trend[-2]
    income, expense = float(current["income"]), float(current["expense"])
    avg_daily = expense / elapsed if elapsed else 0.0
    return {
        "month": month,
        "tx_count": tx_count,
        "savings_rate": (income - expense) / income * 100 if income > 0 else None,
        "avg_daily_expense": avg_daily,
        "projected_expense": avg_daily * days_in_month if is_current else None,
        "biggest_expense": biggest,
        "previous": previous,
        "trend": trend,
    }
