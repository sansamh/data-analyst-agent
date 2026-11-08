import json
import sqlite3
import uuid
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from app.agent import build_agent
from app.config import settings

app = FastAPI(title="DataSage API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in settings.cors_allowed_origins.split(",") if o],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

DB_PATH = Path("./data/datasage.db")
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# in-memory registry for freshly uploaded datasets (id -> workspace path + preview)
_PENDING: dict[str, dict] = {}


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS analyses (
                id TEXT PRIMARY KEY,
                dataset_name TEXT,
                question TEXT,
                status TEXT,
                report_md TEXT,
                charts_json TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )"""
        )


init_db()


def workspace(analysis_id: str) -> Path:
    p = Path(settings.workspace_root) / analysis_id
    p.mkdir(parents=True, exist_ok=True)
    return p


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/datasets")
async def upload_dataset(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "No file")
    analysis_id = uuid.uuid4().hex[:12]
    wd = workspace(analysis_id)
    dest = wd / file.filename
    content = await file.read()
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(400, f"File too large (max {settings.max_upload_mb} MB)")
    dest.write_bytes(content)

    try:
        if dest.suffix.lower() in (".xlsx", ".xls"):
            df = pd.read_excel(dest)
        else:
            df = pd.read_csv(dest)
    except Exception as e:
        raise HTTPException(400, f"Could not parse file: {e}")

    preview = df.head(5).to_markdown(index=False)
    info = {
        "id": analysis_id,
        "name": file.filename,
        "path": str(dest),
        "shape": list(df.shape),
        "columns": [
            {"name": c, "dtype": str(df[c].dtype), "missing": int(df[c].isna().sum())}
            for c in df.columns
        ],
        "preview_md": preview,
    }
    _PENDING[analysis_id] = info
    return info


@app.post("/api/analyses")
async def run_analysis(dataset_id: str = Form(...), question: str = Form(...)):
    info = _PENDING.get(dataset_id)
    if not info:
        raise HTTPException(404, "Dataset not found (upload it again)")

    analysis_id = dataset_id
    wd = workspace(analysis_id)

    cols = "\n".join(
        f"- {c['name']} ({c['dtype']}, {c['missing']} missing)" for c in info["columns"]
    )
    dataset_desc = (
        f"Dataset file: {info['name']} ({info['shape'][0]} rows x {info['shape'][1]} columns)\n"
        f"Columns:\n{cols}\n\nFirst rows:\n{info['preview_md']}"
    )
    agent, user_message = build_agent(wd, dataset_desc, question)

    async def event_stream():
        yield sse("session", json.dumps({"id": analysis_id}))
        turns: list[list[str]] = []
        current: list[str] = []

        try:
            async for ev in agent.astream_events(
                {"messages": [{"role": "user", "content": user_message}]},
                version="v2",
                config={"recursion_limit": 80},
            ):
                kind = ev["event"]
                if kind == "on_chat_model_stream":
                    text = ev["data"]["chunk"].content
                    if isinstance(text, list):
                        text = "".join(t.get("text", "") for t in text if isinstance(t, dict))
                    if text:
                        current.append(text)
                        yield sse("stream-token", text)
                elif kind == "on_chat_model_start":
                    if current:
                        turns.append(current)
                        current = []
                elif kind == "on_tool_start":
                    payload = json.dumps(
                        {"tool": ev["name"], "input": str(ev["data"].get("input", ""))[:200]}
                    )
                    yield sse("tool", payload)

            if current:
                turns.append(current)

            report = ""
            if turns:
                report = "".join(turns[-1]).strip()

            charts = sorted(
                p.name for p in wd.iterdir() if p.suffix.lower() in (".png", ".jpg", ".csv", ".xlsx")
                and p.name != info["name"]
            )
            with db() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO analyses (id, dataset_name, question, status, report_md, charts_json) VALUES (?,?,?,?,?,?)",
                    (analysis_id, info["name"], question, "done", report,
                     json.dumps(charts)),
                )
            yield sse("report", json.dumps({"reportMd": report, "charts": charts}))
            yield sse("done", "{}")
        except Exception as e:
            with db() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO analyses (id, dataset_name, question, status, report_md, charts_json) VALUES (?,?,?,?,?,?)",
                    (analysis_id, info["name"], question, "failed", f"Failed: {e}", "[]"),
                )
            yield sse("error", json.dumps({"message": str(e)[:300]}))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/analyses")
def list_analyses():
    with db() as conn:
        rows = conn.execute(
            "SELECT id, dataset_name, question, status, created_at FROM analyses ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/analyses/{analysis_id}")
def get_analysis(analysis_id: str):
    with db() as conn:
        row = conn.execute("SELECT * FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    d = dict(row)
    d["charts"] = json.loads(d.get("charts_json") or "[]")
    del d["charts_json"]
    return d


@app.delete("/api/analyses/{analysis_id}")
def delete_analysis(analysis_id: str):
    with db() as conn:
        conn.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,))
    return {"ok": True}


@app.get("/api/analyses/{analysis_id}/files/{name}")
def get_file(analysis_id: str, name: str):
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "Bad file name")
    p = workspace(analysis_id) / name
    if not p.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(p)


def sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"
