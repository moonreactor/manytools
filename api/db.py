import os

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

pool = ConnectionPool(
    os.environ.get("DATABASE_URL", ""),
    kwargs={"row_factory": dict_row},
    open=False,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS fin_categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    UNIQUE (name, type)
);

CREATE TABLE IF NOT EXISTS fin_profiles (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fin_transactions (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    category_id INT REFERENCES fin_categories (id) ON DELETE SET NULL,
    description TEXT NOT NULL DEFAULT '',
    date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fin_transactions_date_idx ON fin_transactions (date);

ALTER TABLE fin_transactions
    ADD COLUMN IF NOT EXISTS profile_id INT REFERENCES fin_profiles (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS fin_transactions_profile_idx ON fin_transactions (profile_id);
"""

TASKS_SCHEMA = """
CREATE TABLE IF NOT EXISTS task_members (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_columns (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    position INT NOT NULL,
    is_done BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    assignee_id INT REFERENCES task_members (id) ON DELETE SET NULL,
    due_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS column_id INT REFERENCES task_columns (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS tasks_column_idx ON tasks (column_id);
"""

COURSES_SCHEMA = """
CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    playlist_id TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL DEFAULT '',
    thumbnail TEXT NOT NULL DEFAULT '',
    last_video_id INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_videos (
    id SERIAL PRIMARY KEY,
    course_id INT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    position INT NOT NULL,
    duration INT NOT NULL DEFAULT 0,
    thumbnail TEXT NOT NULL DEFAULT '',
    completed_at TIMESTAMPTZ,
    watched INT NOT NULL DEFAULT 0,
    UNIQUE (course_id, video_id)
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS autoplay BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS course_videos_course_idx ON course_videos (course_id, position);
"""

MEALS_SCHEMA = """
CREATE TABLE IF NOT EXISTS meals (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    slot TEXT NOT NULL CHECK (slot IN ('desayuno', 'almuerzo', 'merienda', 'cena')),
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meals_date_idx ON meals (date);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

SOCIAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS soc_users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soc_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INT NOT NULL REFERENCES soc_users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soc_interests (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS soc_user_interests (
    user_id INT NOT NULL REFERENCES soc_users (id) ON DELETE CASCADE,
    interest_id INT NOT NULL REFERENCES soc_interests (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, interest_id)
);

CREATE TABLE IF NOT EXISTS soc_posts (
    id SERIAL PRIMARY KEY,
    author_id INT NOT NULL REFERENCES soc_users (id) ON DELETE CASCADE,
    interest_id INT NOT NULL REFERENCES soc_interests (id),
    kind TEXT NOT NULL CHECK (kind IN ('note', 'product', 'service')),
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    price NUMERIC(14, 2) CHECK (price IS NULL OR price > 0),
    stock INT CHECK (stock IS NULL OR stock >= 0),
    image_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS soc_posts_feed_idx ON soc_posts (interest_id, id DESC);
CREATE INDEX IF NOT EXISTS soc_posts_author_idx ON soc_posts (author_id, id DESC);

CREATE TABLE IF NOT EXISTS soc_likes (
    post_id INT NOT NULL REFERENCES soc_posts (id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES soc_users (id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS soc_comments (
    id SERIAL PRIMARY KEY,
    post_id INT NOT NULL REFERENCES soc_posts (id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES soc_users (id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS soc_comments_post_idx ON soc_comments (post_id, id);

-- Una orden = un aporte (note), una compra (product) o una contratación (service).
-- Guarda una copia del título: el post puede archivarse sin perder el historial.
CREATE TABLE IF NOT EXISTS soc_orders (
    id SERIAL PRIMARY KEY,
    post_id INT REFERENCES soc_posts (id) ON DELETE SET NULL,
    post_title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'product', 'service')),
    buyer_id INT NOT NULL REFERENCES soc_users (id),
    seller_id INT NOT NULL REFERENCES soc_users (id),
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    fee NUMERIC(14, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('paid', 'fulfilled', 'cancelled')),
    note TEXT NOT NULL DEFAULT '',
    payment_ref TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE soc_posts ADD COLUMN IF NOT EXISTS payment_url TEXT NOT NULL DEFAULT '';
ALTER TABLE soc_orders DROP CONSTRAINT IF EXISTS soc_orders_status_check;
ALTER TABLE soc_orders ADD CONSTRAINT soc_orders_status_check
    CHECK (status IN ('pending', 'paid', 'fulfilled', 'cancelled'));
CREATE INDEX IF NOT EXISTS soc_orders_buyer_idx ON soc_orders (buyer_id, id DESC);
CREATE INDEX IF NOT EXISTS soc_orders_seller_idx ON soc_orders (seller_id, id DESC);
"""

DEFAULT_INTERESTS = [
    ("tecnologia", "Tecnología", "💻"),
    ("diseno", "Diseño", "🎨"),
    ("musica", "Música", "🎵"),
    ("fotografia", "Fotografía", "📷"),
    ("cocina", "Cocina", "🍳"),
    ("deportes", "Deportes", "⚽"),
    ("viajes", "Viajes", "✈️"),
    ("libros", "Libros", "📚"),
    ("cine", "Cine y series", "🎬"),
    ("juegos", "Videojuegos", "🎮"),
    ("moda", "Moda", "👗"),
    ("arte", "Arte y manualidades", "🧵"),
    ("salud", "Salud y bienestar", "🧘"),
    ("negocios", "Negocios", "📈"),
    ("educacion", "Educación", "🎓"),
    ("mascotas", "Mascotas", "🐾"),
    ("hogar", "Hogar y jardín", "🪴"),
    ("autos", "Autos y motos", "🏍️"),
]

DEFAULT_TASK_COLUMNS = [
    ("Por hacer", False, "todo"),
    ("En curso", False, "doing"),
    ("Hecho", True, "done"),
]

DEFAULT_CATEGORIES = [
    ("Sueldo", "income"),
    ("Freelance", "income"),
    ("Otros ingresos", "income"),
    ("Alquiler", "expense"),
    ("Supermercado", "expense"),
    ("Transporte", "expense"),
    ("Servicios", "expense"),
    ("Salidas", "expense"),
    ("Salud", "expense"),
    ("Suscripciones", "expense"),
    ("Otros gastos", "expense"),
]


def init_db() -> None:
    with pool.connection() as conn:
        conn.execute(SCHEMA)
        conn.execute(TASKS_SCHEMA)
        init_task_columns(conn)
        conn.execute(COURSES_SCHEMA)
        conn.execute(MEALS_SCHEMA)
        conn.execute(SOCIAL_SCHEMA)
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO soc_interests (slug, name, emoji) VALUES (%s, %s, %s) "
                "ON CONFLICT (slug) DO NOTHING",
                DEFAULT_INTERESTS,
            )
        count = conn.execute("SELECT count(*) AS n FROM fin_categories").fetchone()["n"]
        if count == 0:
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO fin_categories (name, type) VALUES (%s, %s)",
                    DEFAULT_CATEGORIES,
                )


def init_task_columns(conn) -> None:
    """Siembra las columnas por defecto y migra el viejo campo tasks.status."""
    n = conn.execute("SELECT count(*) AS n FROM task_columns").fetchone()["n"]
    if n == 0:
        for pos, (name, is_done, _) in enumerate(DEFAULT_TASK_COLUMNS):
            conn.execute(
                "INSERT INTO task_columns (name, position, is_done) VALUES (%s, %s, %s)",
                (name, pos, is_done),
            )
    has_status = conn.execute(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = 'tasks' AND column_name = 'status'"
    ).fetchone()
    if has_status:
        for name, _, legacy in DEFAULT_TASK_COLUMNS:
            conn.execute(
                "UPDATE tasks SET column_id = (SELECT id FROM task_columns WHERE name = %s "
                "ORDER BY position LIMIT 1) WHERE column_id IS NULL AND status = %s",
                (name, legacy),
            )
        conn.execute("ALTER TABLE tasks DROP COLUMN status")
