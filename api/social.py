import hashlib
import hmac
import os
import re
import secrets
from urllib.parse import urlparse
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, Field

from db import pool
from payments import FEE_PCT, charge, platform_fee, refund

router = APIRouter(prefix="/social", tags=["social"])

Kind = Literal["note", "product", "service"]
USERNAME_RE = re.compile(r"^[a-z0-9_]{3,24}$")
PAGE = 20
MP_HOST_RE = re.compile(r"^(([a-z0-9-]+\.)*mercadopago\.com(\.[a-z]{2})?|([a-z0-9-]+\.)*mpago\.(la|li))$")


def clean_payment_url(url: str) -> str:
    """Solo links https de Mercado Pago (evita que se use el post para redirigir a cualquier sitio)."""
    url = url.strip()
    if not url:
        return ""
    u = urlparse(url)
    if u.scheme != "https" or not MP_HOST_RE.match((u.hostname or "").lower()):
        raise HTTPException(422, "El link de pago tiene que ser un link https de Mercado Pago")
    return url


# ---------- auth ----------
def hash_pw(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}:{h.hex()}"


def check_pw(pw: str, stored: str) -> bool:
    salt_hex, h_hex = stored.split(":")
    h = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return hmac.compare_digest(h.hex(), h_hex)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


USER_COLS = "u.id, u.username, u.display_name, u.bio, u.created_at"


def optional_user(authorization: str | None = Header(default=None)) -> dict | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    with pool.connection() as conn:
        return conn.execute(
            f"SELECT {USER_COLS} FROM soc_sessions s JOIN soc_users u ON u.id = s.user_id "
            "WHERE s.token_hash = %s",
            (token_hash(authorization[7:]),),
        ).fetchone()


def current_user(user: dict | None = Depends(optional_user)) -> dict:
    if not user:
        raise HTTPException(401, "Iniciá sesión para continuar")
    return user


# ---------- models ----------
class RegisterIn(BaseModel):
    username: str
    display_name: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=8, max_length=200)
    interest_ids: list[int] = []


class LoginIn(BaseModel):
    username: str
    password: str


class User(BaseModel):
    id: int
    username: str
    display_name: str
    bio: str
    created_at: datetime


class AuthOut(BaseModel):
    token: str
    user: User


class ProfileIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=50)
    bio: str = Field(default="", max_length=300)


class Interest(BaseModel):
    id: int
    slug: str
    name: str
    emoji: str


class InterestsIn(BaseModel):
    ids: list[int]


class PostIn(BaseModel):
    kind: Kind
    interest_id: int
    title: str = Field(min_length=1, max_length=140)
    body: str = Field(default="", max_length=5000)
    price: Decimal | None = Field(default=None, gt=0, le=Decimal("99999999"), decimal_places=2)
    stock: int | None = Field(default=None, ge=0, le=1_000_000)
    image_url: str = Field(default="", max_length=500)
    payment_url: str = Field(default="", max_length=500)


class Post(BaseModel):
    id: int
    kind: Kind
    title: str
    body: str
    price: float | None
    stock: int | None
    image_url: str
    payment_url: str
    status: str
    created_at: datetime
    interest_id: int
    interest_slug: str
    interest_name: str
    interest_emoji: str
    author_id: int
    username: str
    display_name: str
    likes: int
    comments: int
    sales: int
    liked: bool


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class Comment(BaseModel):
    id: int
    body: str
    created_at: datetime
    username: str
    display_name: str


class PayIn(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0, le=Decimal("99999999"), decimal_places=2)
    quantity: int = Field(default=1, ge=1, le=1000)
    note: str = Field(default="", max_length=1000)


class Order(BaseModel):
    id: int
    post_id: int | None
    post_title: str
    kind: Kind
    quantity: int
    amount: float
    fee: float
    status: str
    note: str
    payment_url: str
    created_at: datetime
    buyer_username: str
    buyer_name: str
    seller_username: str
    seller_name: str


class OrderStatusIn(BaseModel):
    status: Literal["paid", "fulfilled", "cancelled"]


def clean(s: str) -> str:
    return s.strip()


# ---------- auth endpoints ----------
def new_session(conn, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO soc_sessions (token_hash, user_id) VALUES (%s, %s)",
        (token_hash(token), user_id),
    )
    return token


def check_interest_ids(conn, ids: list[int]) -> list[int]:
    ids = list(dict.fromkeys(ids))
    if ids:
        n = conn.execute(
            "SELECT count(*) AS n FROM soc_interests WHERE id = ANY(%s)", (ids,)
        ).fetchone()["n"]
        if n != len(ids):
            raise HTTPException(422, "Interés inexistente")
    return ids


@router.post("/auth/register", response_model=AuthOut, status_code=201)
def register(body: RegisterIn):
    username = body.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(422, "Usuario: 3 a 24 caracteres (letras, números o _)")
    name = clean(body.display_name)
    if not name:
        raise HTTPException(422, "Nombre vacío")
    with pool.connection() as conn:
        ids = check_interest_ids(conn, body.interest_ids)
        try:
            user = conn.execute(
                "INSERT INTO soc_users (username, display_name, password_hash) "
                "VALUES (%s, %s, %s) "
                "RETURNING id, username, display_name, bio, created_at",
                (username, name, hash_pw(body.password)),
            ).fetchone()
        except UniqueViolation:
            raise HTTPException(409, "Ese usuario ya existe")
        for iid in ids:
            conn.execute(
                "INSERT INTO soc_user_interests (user_id, interest_id) VALUES (%s, %s)",
                (user["id"], iid),
            )
        return {"token": new_session(conn, user["id"]), "user": user}


@router.post("/auth/login", response_model=AuthOut)
def login(body: LoginIn):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT id, username, display_name, bio, created_at, password_hash "
            "FROM soc_users WHERE username = %s",
            (body.username.strip().lower(),),
        ).fetchone()
        if not row or not check_pw(body.password, row["password_hash"]):
            raise HTTPException(401, "Usuario o contraseña incorrectos")
        return {"token": new_session(conn, row["id"]), "user": row}


@router.post("/auth/logout", status_code=204)
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        with pool.connection() as conn:
            conn.execute(
                "DELETE FROM soc_sessions WHERE token_hash = %s",
                (token_hash(authorization[7:]),),
            )


@router.get("/me", response_model=User)
def me(user: dict = Depends(current_user)):
    return user


@router.put("/me", response_model=User)
def update_me(body: ProfileIn, user: dict = Depends(current_user)):
    name = clean(body.display_name)
    if not name:
        raise HTTPException(422, "Nombre vacío")
    with pool.connection() as conn:
        return conn.execute(
            "UPDATE soc_users SET display_name = %s, bio = %s WHERE id = %s "
            "RETURNING id, username, display_name, bio, created_at",
            (name, clean(body.bio), user["id"]),
        ).fetchone()


# ---------- interests ----------
@router.get("/interests", response_model=list[Interest])
def list_interests():
    with pool.connection() as conn:
        return conn.execute("SELECT id, slug, name, emoji FROM soc_interests ORDER BY name").fetchall()


@router.get("/me/interests", response_model=list[int])
def my_interests(user: dict = Depends(current_user)):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT interest_id FROM soc_user_interests WHERE user_id = %s", (user["id"],)
        ).fetchall()
        return [r["interest_id"] for r in rows]


@router.put("/me/interests", response_model=list[int])
def set_my_interests(body: InterestsIn, user: dict = Depends(current_user)):
    with pool.connection() as conn:
        ids = check_interest_ids(conn, body.ids)
        conn.execute("DELETE FROM soc_user_interests WHERE user_id = %s", (user["id"],))
        for iid in ids:
            conn.execute(
                "INSERT INTO soc_user_interests (user_id, interest_id) VALUES (%s, %s)",
                (user["id"], iid),
            )
        return ids


# ---------- posts ----------
POST_SELECT = """
SELECT p.id, p.kind, p.title, p.body, p.price, p.stock, p.image_url, p.payment_url, p.status, p.created_at,
       p.interest_id, i.slug AS interest_slug, i.name AS interest_name, i.emoji AS interest_emoji,
       u.id AS author_id, u.username, u.display_name,
       (SELECT count(*) FROM soc_likes l WHERE l.post_id = p.id) AS likes,
       (SELECT count(*) FROM soc_comments c WHERE c.post_id = p.id) AS comments,
       (SELECT count(*) FROM soc_orders o WHERE o.post_id = p.id AND o.status IN ('paid', 'fulfilled')) AS sales,
       EXISTS (SELECT 1 FROM soc_likes l WHERE l.post_id = p.id AND l.user_id = %(me)s) AS liked
FROM soc_posts p
JOIN soc_interests i ON i.id = p.interest_id
JOIN soc_users u ON u.id = p.author_id
"""


def get_post(conn, post_id: int, me: dict | None) -> dict:
    row = conn.execute(
        POST_SELECT + "WHERE p.id = %(id)s", {"me": me["id"] if me else -1, "id": post_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "Publicación no encontrada")
    return row


def validate_post(body: PostIn) -> tuple[str, str, Decimal | None, int | None]:
    clean_payment_url(body.payment_url)
    title = clean(body.title)
    if not title:
        raise HTTPException(422, "Título vacío")
    if body.kind == "note":
        return title, clean(body.body), None, None
    if body.price is None:
        raise HTTPException(422, "Ingresá un precio")
    if body.kind == "product":
        return title, clean(body.body), body.price, body.stock  # stock None = ilimitado
    return title, clean(body.body), body.price, None


@router.get("/posts", response_model=list[Post])
def list_posts(
    interest: str | None = None,
    kind: Kind | None = None,
    author: str | None = None,
    q: str | None = Query(default=None, max_length=100),
    feed: Literal["all", "mine"] = "all",
    before: int | None = None,
    user: dict | None = Depends(optional_user),
):
    where = ["p.status = 'active'"]
    params: dict = {"me": user["id"] if user else -1, "limit": PAGE}
    if interest:
        where.append("i.slug = %(interest)s")
        params["interest"] = interest
    if kind:
        where.append("p.kind = %(kind)s")
        params["kind"] = kind
    if author:
        where.append("u.username = %(author)s")
        params["author"] = author.lower()
    if q and q.strip():
        where.append("(p.title ILIKE %(q)s OR p.body ILIKE %(q)s)")
        params["q"] = f"%{q.strip()}%"
    if feed == "mine":
        if not user:
            raise HTTPException(401, "Iniciá sesión para ver tu feed")
        where.append(
            "(p.interest_id IN (SELECT interest_id FROM soc_user_interests WHERE user_id = %(me)s)"
            " OR p.author_id = %(me)s)"
        )
    if before:
        where.append("p.id < %(before)s")
        params["before"] = before
    sql = POST_SELECT + "WHERE " + " AND ".join(where) + " ORDER BY p.id DESC LIMIT %(limit)s"
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchall()


@router.post("/posts", response_model=Post, status_code=201)
def create_post(body: PostIn, user: dict = Depends(current_user)):
    title, text, price, stock = validate_post(body)
    with pool.connection() as conn:
        check_interest_ids(conn, [body.interest_id])
        new_id = conn.execute(
            "INSERT INTO soc_posts (author_id, interest_id, kind, title, body, price, stock, image_url, payment_url) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (user["id"], body.interest_id, body.kind, title, text, price, stock, clean(body.image_url),
             clean_payment_url(body.payment_url)),
        ).fetchone()["id"]
        return get_post(conn, new_id, user)


@router.get("/posts/{post_id}", response_model=Post)
def read_post(post_id: int, user: dict | None = Depends(optional_user)):
    with pool.connection() as conn:
        return get_post(conn, post_id, user)


@router.put("/posts/{post_id}", response_model=Post)
def update_post(post_id: int, body: PostIn, user: dict = Depends(current_user)):
    title, text, price, stock = validate_post(body)
    with pool.connection() as conn:
        check_interest_ids(conn, [body.interest_id])
        cur = conn.execute(
            "UPDATE soc_posts SET interest_id=%s, title=%s, body=%s, price=%s, stock=%s, image_url=%s, "
            "payment_url=%s WHERE id=%s AND author_id=%s AND kind=%s",
            (body.interest_id, title, text, price, stock, clean(body.image_url),
             clean_payment_url(body.payment_url),
             post_id, user["id"], body.kind),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Publicación no encontrada")
        return get_post(conn, post_id, user)


@router.delete("/posts/{post_id}", status_code=204)
def archive_post(post_id: int, user: dict = Depends(current_user)):
    """Archiva (no borra): las órdenes ya hechas conservan su historial."""
    with pool.connection() as conn:
        cur = conn.execute(
            "UPDATE soc_posts SET status = 'archived' WHERE id = %s AND author_id = %s",
            (post_id, user["id"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Publicación no encontrada")


@router.post("/posts/{post_id}/like", response_model=Post)
def toggle_like(post_id: int, user: dict = Depends(current_user)):
    with pool.connection() as conn:
        get_post(conn, post_id, user)
        cur = conn.execute(
            "DELETE FROM soc_likes WHERE post_id = %s AND user_id = %s", (post_id, user["id"])
        )
        if cur.rowcount == 0:
            conn.execute(
                "INSERT INTO soc_likes (post_id, user_id) VALUES (%s, %s)", (post_id, user["id"])
            )
        return get_post(conn, post_id, user)


# ---------- comments ----------
@router.get("/posts/{post_id}/comments", response_model=list[Comment])
def list_comments(post_id: int):
    with pool.connection() as conn:
        return conn.execute(
            "SELECT c.id, c.body, c.created_at, u.username, u.display_name "
            "FROM soc_comments c JOIN soc_users u ON u.id = c.user_id "
            "WHERE c.post_id = %s ORDER BY c.id",
            (post_id,),
        ).fetchall()


@router.post("/posts/{post_id}/comments", response_model=Comment, status_code=201)
def add_comment(post_id: int, body: CommentIn, user: dict = Depends(current_user)):
    text = clean(body.body)
    if not text:
        raise HTTPException(422, "Comentario vacío")
    with pool.connection() as conn:
        get_post(conn, post_id, user)
        return conn.execute(
            "WITH c AS (INSERT INTO soc_comments (post_id, user_id, body) VALUES (%s, %s, %s) "
            "RETURNING id, body, created_at) "
            "SELECT c.id, c.body, c.created_at, %s AS username, %s AS display_name FROM c",
            (post_id, user["id"], text, user["username"], user["display_name"]),
        ).fetchone()


# ---------- pagos / órdenes ----------
ORDER_SELECT = """
SELECT o.id, o.post_id, o.post_title, o.kind, o.quantity, o.amount, o.fee, o.status, o.note,
       COALESCE(p.payment_url, '') AS payment_url, o.created_at, b.username AS buyer_username, b.display_name AS buyer_name,
       s.username AS seller_username, s.display_name AS seller_name
FROM soc_orders o
LEFT JOIN soc_posts p ON p.id = o.post_id
JOIN soc_users b ON b.id = o.buyer_id
JOIN soc_users s ON s.id = o.seller_id
"""


@router.post("/posts/{post_id}/pay", response_model=Order, status_code=201)
def pay(post_id: int, body: PayIn, user: dict = Depends(current_user)):
    """Nota → aporte libre. Producto → compra (descuenta stock). Servicio → contratación."""
    with pool.connection() as conn:
        post = conn.execute(
            "SELECT id, author_id, kind, title, price, stock, payment_url FROM soc_posts "
            "WHERE id = %s AND status = 'active' FOR UPDATE",
            (post_id,),
        ).fetchone()
        if not post:
            raise HTTPException(404, "Publicación no encontrada")
        if post["author_id"] == user["id"]:
            raise HTTPException(409, "No podés pagarte a vos mismo")

        quantity = 1
        if post["kind"] == "note":
            if body.amount is None:
                raise HTTPException(422, "Ingresá el monto del aporte")
            amount, status = body.amount, "fulfilled"
        elif post["kind"] == "product":
            quantity = body.quantity
            if not clean(body.note):
                raise HTTPException(422, "Indicá la dirección de entrega")
            if post["stock"] is not None:
                if post["stock"] < quantity:
                    raise HTTPException(409, "No hay stock suficiente")
                conn.execute(
                    "UPDATE soc_posts SET stock = stock - %s WHERE id = %s", (quantity, post_id)
                )
            amount, status = post["price"] * quantity, "paid"
        else:
            if not clean(body.note):
                raise HTTPException(422, "Contale al vendedor qué necesitás")
            amount, status = post["price"], "paid"

        if post["payment_url"]:
            # Pago por el link de Mercado Pago del vendedor: no podemos verificarlo,
            # la orden queda pendiente hasta que el vendedor confirme que lo recibió.
            ref, status = "", "pending"
        else:
            try:
                ref = charge(amount, post["title"], user["id"], post["author_id"])
            except Exception:
                raise HTTPException(502, "No se pudo procesar el pago")
        order_id = conn.execute(
            "INSERT INTO soc_orders (post_id, post_title, kind, buyer_id, seller_id, quantity, "
            "amount, fee, status, note, payment_ref) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (post_id, post["title"], post["kind"], user["id"], post["author_id"], quantity,
             amount, platform_fee(amount), status, clean(body.note), ref),
        ).fetchone()["id"]
        return conn.execute(ORDER_SELECT + "WHERE o.id = %s", (order_id,)).fetchone()


@router.get("/orders", response_model=list[Order])
def list_orders(role: Literal["buyer", "seller"] = "buyer", user: dict = Depends(current_user)):
    col = "buyer_id" if role == "buyer" else "seller_id"
    with pool.connection() as conn:
        return conn.execute(
            ORDER_SELECT + f"WHERE o.{col} = %s ORDER BY o.id DESC LIMIT 200", (user["id"],)
        ).fetchall()


ORDER_FLOW = {
    "pending": {"paid", "fulfilled", "cancelled"},
    "paid": {"fulfilled", "cancelled"},
}


@router.patch("/orders/{order_id}", response_model=Order)
def update_order(order_id: int, body: OrderStatusIn, user: dict = Depends(current_user)):
    """El vendedor confirma el pago, marca la entrega/realización, o cancela (devuelve el stock)."""
    with pool.connection() as conn:
        o = conn.execute(
            "SELECT id, post_id, quantity, status, payment_ref FROM soc_orders "
            "WHERE id = %s AND seller_id = %s FOR UPDATE",
            (order_id, user["id"]),
        ).fetchone()
        if not o:
            raise HTTPException(404, "Orden no encontrada")
        if body.status not in ORDER_FLOW.get(o["status"], set()):
            raise HTTPException(409, "La orden no puede pasar a ese estado")
        if body.status == "cancelled":
            if o["payment_ref"]:
                refund(o["payment_ref"])
            conn.execute(
                "UPDATE soc_posts SET stock = stock + %s WHERE id = %s AND stock IS NOT NULL",
                (o["quantity"], o["post_id"]),
            )
        conn.execute("UPDATE soc_orders SET status = %s WHERE id = %s", (body.status, order_id))
        return conn.execute(ORDER_SELECT + "WHERE o.id = %s", (order_id,)).fetchone()


@router.get("/me/earnings")
def earnings(user: dict = Depends(current_user)):
    """Resumen de lo cobrado como vendedor (sin órdenes canceladas)."""
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT kind, count(*) AS orders, COALESCE(sum(amount), 0) AS gross, "
            "COALESCE(sum(fee), 0) AS fee, "
            "COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0) AS pending "
            "FROM soc_orders WHERE seller_id = %s AND status IN ('paid', 'fulfilled') GROUP BY kind",
            (user["id"],),
        ).fetchall()
    by_kind = {
        r["kind"]: {"orders": r["orders"], "gross": float(r["gross"]), "fee": float(r["fee"])}
        for r in rows
    }
    gross = sum(float(r["gross"]) for r in rows)
    fee = sum(float(r["fee"]) for r in rows)
    return {
        "gross": gross,
        "fee": fee,
        "net": gross - fee,
        "pending": sum(float(r["pending"]) for r in rows),
        "fee_pct": float(FEE_PCT),
        "by_kind": by_kind,
    }


@router.get("/users/{username}")
def read_user(username: str):
    with pool.connection() as conn:
        u = conn.execute(
            f"SELECT {USER_COLS} FROM soc_users u WHERE u.username = %s", (username.lower(),)
        ).fetchone()
        if not u:
            raise HTTPException(404, "Usuario no encontrado")
        u["interests"] = conn.execute(
            "SELECT i.id, i.slug, i.name, i.emoji FROM soc_user_interests ui "
            "JOIN soc_interests i ON i.id = ui.interest_id WHERE ui.user_id = %s ORDER BY i.name",
            (u["id"],),
        ).fetchall()
        u["posts"] = conn.execute(
            "SELECT count(*) AS n FROM soc_posts WHERE author_id = %s AND status = 'active'",
            (u["id"],),
        ).fetchone()["n"]
        return u
