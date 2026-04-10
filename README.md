# MLB Win Predictor

A portfolio-ready full-stack baseball analytics project that serves model predictions from a FastAPI backend and renders a clean dashboard with Next.js.

## Project Overview

MLB Win Predictor is designed as a production-style starter for sports prediction products. It includes:

- A **FastAPI API** for health checks, mock daily predictions, and model performance metrics.
- A **Next.js dashboard** with routes for featured picks, prediction history, and model metrics.
- A clear, typed structure that is ready for real data ingestion, model integration, and deployment.

## Tech Stack

### Backend
- Python 3.10+
- FastAPI
- Pydantic
- Uvicorn

### Frontend
- Next.js (App Router)
- TypeScript
- Tailwind CSS

## Features

- Dashboard view for today’s MLB picks
- Historical prediction cards
- Model metrics cards
- Typed frontend mock-data layer for easy API swap-in
- REST API endpoints with documented schemas
- Health endpoint for infrastructure monitoring

## Screenshots

> Add screenshots here after UI updates.

- `![Predictions Dashboard](docs/screenshots/predictions-dashboard.png)`
- `![Prediction History](docs/screenshots/prediction-history.png)`
- `![Model Metrics](docs/screenshots/model-metrics.png)`

## Local Setup Instructions

### Prerequisites

- Python 3.10+
- Node.js 20+
- npm 10+

### 1) Clone and enter the repository

```bash
git clone <your-repo-url>
cd mlb-win-predictor
```

### 2) Start the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend runs at: <http://localhost:8000>

### 3) Start the frontend

Open a new terminal window:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at: <http://localhost:3000>

## API Routes

Base URL (local): `http://localhost:8000`

- `GET /health`
  - Service health probe.
  - Example response: `{ "status": "ok" }`

- `GET /api/predictions/today`
  - Returns mock predictions for the current date.

- `GET /api/metrics`
  - Returns mock model performance metrics.

- `GET /docs`
  - Interactive Swagger documentation.

## Future Improvements

- Replace mock responses with live MLB schedule, odds, and results ingestion
- Add model training pipeline and experiment tracking
- Persist predictions and outcomes in a relational database
- Add authentication and per-user watchlists
- Add CI/CD, linting, formatting checks, and containerized deployment
- Add automated frontend and backend test suites
