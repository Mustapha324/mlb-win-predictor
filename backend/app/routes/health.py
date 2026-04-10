"""Health-check routes for uptime monitoring."""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict[str, str]:
    """Return a simple service status payload."""
    return {"status": "ok"}
