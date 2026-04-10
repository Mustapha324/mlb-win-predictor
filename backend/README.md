# Backend (FastAPI)

## Run locally

1. Create and activate a virtual environment:
   - macOS/Linux: `python -m venv .venv && source .venv/bin/activate`
   - Windows (PowerShell): `python -m venv .venv; .venv\\Scripts\\Activate.ps1`
2. Install dependencies: `pip install -r requirements.txt`
3. Start server: `uvicorn app.main:app --reload`
4. Open API docs: <http://localhost:8000/docs>
