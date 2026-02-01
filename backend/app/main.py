from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import antibodies, audit, auth, lots, scan, storage, vials, labs, documents, fluorochromes

app = FastAPI(title="LabAid - Flow Cytometry Inventory", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(labs.router)
app.include_router(antibodies.router)
app.include_router(lots.router)
app.include_router(vials.router)
app.include_router(storage.router)
app.include_router(scan.router)
app.include_router(audit.router)
app.include_router(documents.router)
app.include_router(fluorochromes.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
