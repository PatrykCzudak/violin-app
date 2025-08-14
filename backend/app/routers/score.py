from fastapi import APIRouter, File, UploadFile
import os
import uuid

router = APIRouter()

UPLOAD_DIR = "backend/data/scores"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload")
async def upload_score(file: UploadFile = File(...)):
    """
    Odbiera plik MusicXML lub MXL, zapisuje go i zwraca URL do pobrania.
    OSMD potrafi wczytać zarówno .xml/.musicxml, jak i .mxl (Compressed MusicXML).
    """
    filename = file.filename or "score.musicxml"
    name, ext = os.path.splitext(filename)
    unique_name = f"{name}_{uuid.uuid4().hex}{ext}"
    save_path = os.path.join(UPLOAD_DIR, unique_name)
    with open(save_path, "wb") as f:
        content = await file.read()
        f.write(content)
    url = f"/media/scores/{unique_name}"
    return {"url": url}
