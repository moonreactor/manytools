import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db import pool

router = APIRouter(prefix="/meals", tags=["meals"])

Slot = Literal["desayuno", "almuerzo", "merienda", "cena"]


class MealIn(BaseModel):
    date: date
    slot: Slot
    title: str = Field(min_length=1, max_length=200)
    notes: str = Field(default="", max_length=2000)


class Meal(MealIn):
    id: int


COLS = "id, date, slot, title, notes"

RECIPE_API = "https://recipeapi.io/api/v1"
KEY_NAME = "recipeapi_key"


# ---------- API key de recipeapi.io (se guarda en el servidor, nunca se devuelve completa) ----------
class KeyIn(BaseModel):
    api_key: str = Field(min_length=1, max_length=200)


def get_key() -> str | None:
    with pool.connection() as conn:
        row = conn.execute("SELECT value FROM app_settings WHERE key = %s", (KEY_NAME,)).fetchone()
    return row["value"] if row else None


def key_status() -> dict:
    key = get_key()
    return {"configured": bool(key), "preview": f"…{key[-4:]}" if key else None}


@router.get("/settings")
def get_settings():
    return key_status()


@router.put("/settings")
def set_settings(body: KeyIn):
    key = body.api_key.strip()
    if not key:
        raise HTTPException(422, "API key vacía")
    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (%s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (KEY_NAME, key),
        )
    return key_status()


@router.delete("/settings", status_code=204)
def delete_settings():
    with pool.connection() as conn:
        conn.execute("DELETE FROM app_settings WHERE key = %s", (KEY_NAME,))


# ---------- proxy a recipeapi.io ----------
RECIPE_PARAMS = {
    "search", "ingredients", "meal_type", "cuisine", "dietary_tags", "difficulty",
    "calories_per_serving_max", "calories_per_serving_min", "protein_min", "protein_max",
    "prep_time_min", "prep_time_max", "cook_time_min", "cook_time_max",
    "sort", "order", "per_page", "page",
}


@router.get("/recipes")
def search_recipes(
    search: str | None = None,
    ingredients: str | None = None,
    meal_type: str | None = None,
    cuisine: str | None = None,
    dietary_tags: str | None = None,
    difficulty: str | None = None,
    calories_per_serving_max: int | None = None,
    calories_per_serving_min: int | None = None,
    protein_min: int | None = None,
    protein_max: int | None = None,
    prep_time_min: int | None = None,
    prep_time_max: int | None = None,
    cook_time_min: int | None = None,
    cook_time_max: int | None = None,
    sort: str | None = None,
    order: str | None = None,
    per_page: int | None = None,
    page: int | None = None,
):
    key = get_key()
    if not key:
        raise HTTPException(400, "Configurá tu API key de recipeapi.io primero")
    params = {k: v for k, v in locals().items() if k in RECIPE_PARAMS and v not in (None, "")}
    req = urllib.request.Request(
        f"{RECIPE_API}/recipes?{urllib.parse.urlencode(params)}",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        try:
            err = json.load(e).get("error", {})
        except Exception:
            err = {}
        msg = err.get("message") or f"recipeapi.io respondió {e.code}"
        if e.code == 401:
            msg = "API key inválida o faltante"
        elif e.code == 429:
            msg = "Límite de uso de recipeapi.io alcanzado"
        raise HTTPException(502 if e.code >= 500 else e.code, msg)
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(502, "No se pudo conectar con recipeapi.io")


@router.get("", response_model=list[Meal])
def list_meals(start: date, end: date | None = None):
    """Comidas entre start y end (inclusive). Por defecto, 7 días desde start."""
    end = end or start + timedelta(days=6)
    with pool.connection() as conn:
        return conn.execute(
            f"SELECT {COLS} FROM meals WHERE date BETWEEN %s AND %s ORDER BY date, id",
            (start, end),
        ).fetchall()


@router.post("", response_model=Meal, status_code=201)
def create_meal(body: MealIn):
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "Nombre vacío")
    with pool.connection() as conn:
        return conn.execute(
            "INSERT INTO meals (date, slot, title, notes) VALUES (%s, %s, %s, %s) "
            f"RETURNING {COLS}",
            (body.date, body.slot, title, body.notes),
        ).fetchone()


@router.put("/{meal_id}", response_model=Meal)
def update_meal(meal_id: int, body: MealIn):
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "Nombre vacío")
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE meals SET date=%s, slot=%s, title=%s, notes=%s WHERE id=%s "
            f"RETURNING {COLS}",
            (body.date, body.slot, title, body.notes, meal_id),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Comida no encontrada")
    return row


@router.delete("/{meal_id}", status_code=204)
def delete_meal(meal_id: int):
    with pool.connection() as conn:
        cur = conn.execute("DELETE FROM meals WHERE id = %s", (meal_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Comida no encontrada")
