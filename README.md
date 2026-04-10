# mlb-win-predictor

A full-stack starter project with:

- **Backend:** FastAPI (Python)
- **Frontend:** Next.js App Router + TypeScript

## Project structure

```text
mlb-win-predictor/
  backend/
  frontend/
  README.md
```

## Prerequisites

- Python 3.10+
- Node.js 20+
- npm 10+

## Backend setup (FastAPI)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend will run at: <http://localhost:8000>

Useful endpoints:

- Root: <http://localhost:8000/>
- Health check: <http://localhost:8000/health>
- API docs (Swagger): <http://localhost:8000/docs>

## Frontend setup (Next.js + TypeScript)

```bash
cd frontend
npm install
npm run dev
```

Frontend will run at: <http://localhost:3000>

## Run both together

Open two terminal windows:

1. Terminal A (backend): run FastAPI on port 8000.
2. Terminal B (frontend): run Next.js on port 3000.

Then open <http://localhost:3000>.
