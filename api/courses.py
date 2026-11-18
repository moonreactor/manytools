import json
import re
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db import pool

router = APIRouter(prefix="/courses", tags=["courses"])

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
MAX_VIDEOS = 1000


# ---------- YouTube ----------
def parse_playlist_id(value: str) -> str:
    value = value.strip()
    m = re.search(r"[?&]list=([A-Za-z0-9_-]+)", value)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{10,64}", value):
        return value
    raise HTTPException(422, "No pude encontrar el ID de la lista en ese link")


def _http(url: str, data: bytes | None = None) -> str:
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "User-Agent": UA,
            "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
            "Cookie": "CONSENT=YES+1; SOCS=CAI",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return res.read().decode("utf-8", "replace")


def _walk(node, key):
    """Yield every value stored under `key` anywhere in a nested JSON tree."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key:
                yield v
            else:
                yield from _walk(v, key)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v, key)


def _text(obj) -> str:
    if not obj:
        return ""
    if "simpleText" in obj:
        return obj["simpleText"]
    return "".join(r.get("text", "") for r in obj.get("runs", []))


def _clock(text: str) -> int | None:
    if not re.fullmatch(r"\d{1,2}(:\d{2}){1,2}", text or ""):
        return None
    secs = 0
    for part in text.split(":"):
        secs = secs * 60 + int(part)
    return secs


def _lockup_video(r: dict) -> dict | None:
    if r.get("contentType") != "LOCKUP_CONTENT_TYPE_VIDEO" or not r.get("contentId"):
        return None
    duration = None
    for b in _walk(r.get("contentImage", {}), "thumbnailBadgeViewModel"):
        duration = _clock(b.get("text"))
        if duration:
            break
    if not duration:  # privado / eliminado
        return None
    title = r.get("metadata", {}).get("lockupMetadataViewModel", {}).get("title", {}).get("content", "")
    return {
        "video_id": r["contentId"],
        "title": title,
        "duration": duration,
        "thumbnail": f"https://i.ytimg.com/vi/{r['contentId']}/hqdefault.jpg",
    }


def _videos_from(tree) -> list[dict]:
    out, seen = [], set()
    # Formato anterior (playlistVideoRenderer) y el actual (lockupViewModel)
    for r in _walk(tree, "playlistVideoRenderer"):
        secs = r.get("lengthSeconds")
        if not r.get("videoId") or not secs:
            continue
        out.append(
            {
                "video_id": r["videoId"],
                "title": _text(r.get("title")),
                "duration": int(secs),
                "thumbnail": f"https://i.ytimg.com/vi/{r['videoId']}/hqdefault.jpg",
            }
        )
    for r in _walk(tree, "lockupViewModel"):
        v = _lockup_video(r)
        if v:
            out.append(v)
    return [v for v in out if not (v["video_id"] in seen or seen.add(v["video_id"]))]


def _continuation(tree) -> str | None:
    tokens = [c["token"] for c in _walk(tree, "continuationCommand") if isinstance(c, dict) and "token" in c]
    return tokens[-1] if tokens else None


def fetch_playlist(playlist_id: str) -> dict:
    try:
        html = _http(f"https://www.youtube.com/playlist?list={playlist_id}&hl=es")
    except (urllib.error.URLError, TimeoutError) as e:
        raise HTTPException(502, f"No pude contactar a YouTube: {e}")

    marker = "ytInitialData = "
    i = html.find(marker)
    if i < 0:
        raise HTTPException(502, "YouTube no devolvió datos de la lista")
    data, _ = json.JSONDecoder().raw_decode(html[i + len(marker):])

    meta = data.get("metadata", {}).get("playlistMetadataRenderer", {})
    title = meta.get("title") or ""
    if not title:
        raise HTTPException(404, "Lista no encontrada (¿es privada?)")
    channel = ""
    for o in _walk(data.get("sidebar", {}), "videoOwnerRenderer"):
        channel = _text(o.get("title"))
        break

    videos = _videos_from(data)
    token = _continuation(data)
    while token and len(videos) < MAX_VIDEOS:
        body = json.dumps(
            {
                "context": {"client": {"clientName": "WEB", "clientVersion": "2.20240101.00.00", "hl": "es"}},
                "continuation": token,
            }
        ).encode()
        try:
            page = json.loads(_http("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", body))
        except (urllib.error.URLError, TimeoutError, ValueError):
            break
        have = {v["video_id"] for v in videos}
        more = [v for v in _videos_from(page) if v["video_id"] not in have]
        if not more:
            break
        videos += more
        token = _continuation(page)

    if not videos:
        raise HTTPException(422, "La lista no tiene videos disponibles")
    return {"title": title, "channel": channel, "videos": videos}


# ---------- models ----------
class CourseIn(BaseModel):
    url: str = Field(min_length=1, max_length=500)


class CourseUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    autoplay: bool | None = None


class CompletedIn(BaseModel):
    completed: bool


class ProgressIn(BaseModel):
    watched: int = Field(ge=0, le=100000)  # segundos realmente reproducidos


COMPLETE_RATIO = 0.7


class CurrentIn(BaseModel):
    video_id: int


# ---------- queries ----------
SUMMARY = """
SELECT c.id, c.title, c.playlist_id, c.channel, c.thumbnail, c.last_video_id, c.autoplay,
       count(v.id)::int AS total,
       count(v.completed_at)::int AS completed,
       COALESCE(sum(v.duration), 0)::int AS total_seconds,
       COALESCE(sum(v.duration) FILTER (WHERE v.completed_at IS NOT NULL), 0)::int AS done_seconds,
       max(v.completed_at) AS last_activity
FROM courses c
LEFT JOIN course_videos v ON v.course_id = c.id
"""


def get_summary(conn, course_id: int) -> dict:
    row = conn.execute(SUMMARY + "WHERE c.id = %s GROUP BY c.id", (course_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Curso no encontrado")
    return row


def get_videos(conn, course_id: int) -> list[dict]:
    return conn.execute(
        "SELECT id, video_id, title, position, duration, thumbnail, completed_at, watched "
        "FROM course_videos WHERE course_id = %s ORDER BY position",
        (course_id,),
    ).fetchall()


def detail(conn, course_id: int) -> dict:
    return {**get_summary(conn, course_id), "videos": get_videos(conn, course_id)}


def sync_videos(conn, course_id: int, videos: list[dict]) -> None:
    """Alinea los videos con la lista actual conservando el progreso."""
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO course_videos (course_id, video_id, title, position, duration, thumbnail) "
            "VALUES (%s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (course_id, video_id) DO UPDATE SET "
            "title = EXCLUDED.title, position = EXCLUDED.position, "
            "duration = EXCLUDED.duration, thumbnail = EXCLUDED.thumbnail",
            [(course_id, v["video_id"], v["title"], i, v["duration"], v["thumbnail"])
             for i, v in enumerate(videos)],
        )
    conn.execute(
        "DELETE FROM course_videos WHERE course_id = %s AND video_id <> ALL(%s)",
        (course_id, [v["video_id"] for v in videos]),
    )


# ---------- routes ----------
@router.get("")
def list_courses():
    with pool.connection() as conn:
        return conn.execute(SUMMARY + "GROUP BY c.id ORDER BY c.created_at DESC, c.id DESC").fetchall()


@router.post("", status_code=201)
def create_course(body: CourseIn):
    pid = parse_playlist_id(body.url)
    with pool.connection() as conn:
        if conn.execute("SELECT 1 FROM courses WHERE playlist_id = %s", (pid,)).fetchone():
            raise HTTPException(409, "Ya tenés un curso con esa lista")
    pl = fetch_playlist(pid)
    with pool.connection() as conn:
        cid = conn.execute(
            "INSERT INTO courses (title, playlist_id, channel, thumbnail) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (pl["title"], pid, pl["channel"], pl["videos"][0]["thumbnail"]),
        ).fetchone()["id"]
        sync_videos(conn, cid, pl["videos"])
        return detail(conn, cid)


@router.get("/{course_id}")
def get_course(course_id: int):
    with pool.connection() as conn:
        return detail(conn, course_id)


@router.patch("/{course_id}")
def update_course(course_id: int, body: CourseUpdate):
    title = body.title.strip() if body.title is not None else None
    if title == "":
        raise HTTPException(422, "Título vacío")
    with pool.connection() as conn:
        cur = conn.execute(
            "UPDATE courses SET title = COALESCE(%s, title), autoplay = COALESCE(%s, autoplay) WHERE id = %s",
            (title, body.autoplay, course_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Curso no encontrado")
        return detail(conn, course_id)


@router.post("/{course_id}/sync")
def sync_course(course_id: int):
    with pool.connection() as conn:
        pid = get_summary(conn, course_id)["playlist_id"]
    pl = fetch_playlist(pid)
    with pool.connection() as conn:
        sync_videos(conn, course_id, pl["videos"])
        conn.execute(
            "UPDATE courses SET last_video_id = NULL WHERE id = %s AND last_video_id NOT IN "
            "(SELECT id FROM course_videos WHERE course_id = %s)",
            (course_id, course_id),
        )
        return detail(conn, course_id)


@router.patch("/{course_id}/videos/{video_id}")
def set_completed(course_id: int, video_id: int, body: CompletedIn):
    with pool.connection() as conn:
        cur = conn.execute(
            "UPDATE course_videos SET completed_at = CASE WHEN %s THEN now() ELSE NULL END, "
            "watched = CASE WHEN %s THEN watched ELSE 0 END "
            "WHERE id = %s AND course_id = %s",
            (body.completed, body.completed, video_id, course_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Video no encontrado")
        return detail(conn, course_id)


@router.post("/{course_id}/videos/{video_id}/progress")
def report_progress(course_id: int, video_id: int, body: ProgressIn):
    """Guarda los segundos vistos y completa la clase al superar el 70%."""
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE course_videos SET watched = LEAST(GREATEST(watched, %s), duration), "
            "completed_at = COALESCE(completed_at, CASE WHEN LEAST(GREATEST(watched, %s), duration) "
            ">= duration * %s THEN now() END) "
            "WHERE id = %s AND course_id = %s "
            "RETURNING id, video_id, title, position, duration, thumbnail, completed_at, watched",
            (body.watched, body.watched, COMPLETE_RATIO, video_id, course_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Video no encontrado")
        return {"video": row, "course": get_summary(conn, course_id)}


@router.put("/{course_id}/current")
def set_current(course_id: int, body: CurrentIn):
    with pool.connection() as conn:
        if not conn.execute(
            "SELECT 1 FROM course_videos WHERE id = %s AND course_id = %s",
            (body.video_id, course_id),
        ).fetchone():
            raise HTTPException(404, "Video no encontrado")
        conn.execute("UPDATE courses SET last_video_id = %s WHERE id = %s", (body.video_id, course_id))
        return get_summary(conn, course_id)


@router.delete("/{course_id}", status_code=204)
def delete_course(course_id: int):
    with pool.connection() as conn:
        cur = conn.execute("DELETE FROM courses WHERE id = %s", (course_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Curso no encontrado")
