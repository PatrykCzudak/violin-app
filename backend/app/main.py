from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routers import audio, score, accomp

app = FastAPI(title="Violin AI Backend")

# CORS – dopasuj origin frontendu (Vite domyślnie 5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(audio.router, prefix="/api/audio", tags=["audio"])
app.include_router(score.router, prefix="/api/score", tags=["score"])
app.include_router(accomp.router, prefix="/api/accompaniment", tags=["accompaniment"])

# Serwowanie plików (uploady + wygenerowane)
app.mount("/media", StaticFiles(directory="backend/data"), name="media")

@app.get("/health")
def health():
    return {"ok": True}
