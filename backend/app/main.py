from fastapi import FastAPI

app = FastAPI(title="MLB Win Predictor API")


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "Welcome to the MLB Win Predictor API"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
