"""FastAPI application entrypoint."""

from fastapi import FastAPI

from app.core.config import settings
from app.db.database import Base, engine
from app.routes import health, metrics, predictions, results

app = FastAPI(title=settings.app_name)


@app.on_event("startup")
def create_tables() -> None:
    if engine is not None:
        Base.metadata.create_all(bind=engine)


app.include_router(health.router)
app.include_router(predictions.router, prefix=settings.api_prefix)
app.include_router(metrics.router, prefix=settings.api_prefix)
app.include_router(results.router, prefix=settings.api_prefix)
