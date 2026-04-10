from fastapi import APIRouter

from app.schemas.prediction import ResultsUpdateResponse
from app.services import results

router = APIRouter(prefix="/results", tags=["results"])


@router.post("/update", response_model=ResultsUpdateResponse)
def update_prediction_results() -> ResultsUpdateResponse:
    """Refresh pending predictions with finalized game outcomes and model performance."""
    update_summary = results.update_pending_results()
    return ResultsUpdateResponse(**update_summary)
