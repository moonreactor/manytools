from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from courses import router as courses_router
from db import init_db, pool
from finance import router as finance_router
from meals import router as meals_router
from social import router as social_router
from tasks import router as tasks_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open(wait=True, timeout=30)
    init_db()
    yield
    pool.close()


app = FastAPI(title="ManyTools API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(finance_router)
app.include_router(tasks_router)
app.include_router(courses_router)
app.include_router(meals_router)
app.include_router(social_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/db")
def health_db():
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok", "db": "ok"}
