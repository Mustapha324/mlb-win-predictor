from fastapi import FastAPI

from app.core.config import settings
from app.routes import health, metrics, predictions, results

app = FastAPI(title=settings.app_name)

app.include_router(health.router)
app.include_router(predictions.router, prefix=settings.api_prefix)
app.include_router(metrics.router, prefix=settings.api_prefix)
app.include_router(results.router, prefix=settings.api_prefix)
