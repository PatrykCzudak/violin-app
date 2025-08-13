import os, shutil, uuid
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from ..models.schemas import UploadResponse
from ..services.musicxml import parse_file

router = APIRouter()
SCORES_DIR = "backend/data/scores"

os.makedirs(SCORES_DIR, exist_ok=True)

@router.post("/upload", response_model=UploadResponse)
async def upload_score(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".xml", ".mxl", ".musicxml", ".mid", ".midi"]:
        return JSONResponse(status_code=400, content={"error": "Unsupported file type."})
    fname = f"{uuid.uuid4().hex}{ext}"
    out_path = os.path.join(SCORES_DIR, fname)
    with open(out_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    meta = parse_file(out_path)
    url = f"/media/scores/{fname}"
    return UploadResponse(filename=fname, url=url, kind=meta["kind"], title=meta["title"], parts=meta["parts"], measures=meta["measures"])
