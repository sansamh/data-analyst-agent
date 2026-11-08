# DataSage — Deep Agent Data Analyst

Upload a CSV/Excel file, ask a question in plain language, and a **deep agent** plans the analysis, writes and executes Python code against your data, and delivers a Markdown report with computed findings and charts.

Live demo: **[datasage-eay.pages.dev](https://datasage-eay.pages.dev)** (frontend on Cloudflare Pages, backend on Render free tier — first request after idle takes ~1 min)

![Python](https://img.shields.io/badge/Python-3.12-blue) ![deepagents](https://img.shields.io/badge/deepagents-0.7-green) ![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green) ![React](https://img.shields.io/badge/React-18-blue)

## What makes it a *deep* agent

Built on LangChain's **deepagents** framework — the same architecture family as
Claude Code: a planning-capable agent with a virtual filesystem and sub-agents,
extended here with a code-execution tool.

- **Autonomous code execution** — the agent writes pandas/matplotlib code itself and runs it in a subprocess sandbox (timeout-guarded, stdout captured, created files tracked)
- **Grounded numbers** — the system prompt forbids inventing figures; every number in the report must come from executed code output
- **Self-correction** — on a traceback the agent reads the error, fixes the code and retries
- **Live trace** — tool calls and the model's reasoning stream to the browser over SSE while the analysis runs

## Architecture

```
CSV/Excel upload ──► FastAPI ──► deep agent (deepagents + DeepSeek/Qwen via any
                                 OpenAI-compatible endpoint)
                                   │  tool: execute_python(code)
                                   │  subprocess sandbox: pandas, matplotlib (CJK fonts)
                                   ▼
                          SSE stream: thinking tokens · tool calls · report
                                   ▼
                     React 18 + TS UI: Markdown report + embedded charts
```

## Tech stack

| Layer | Technology |
|---|---|
| Agent | Python 3.12, deepagents 0.7 (LangChain), langchain-openai (any OpenAI-compatible model) |
| Backend | FastAPI, subprocess sandbox, SQLite (history), SSE streaming |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS 4, react-markdown |

## Running locally

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate   # or source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in keys
python -m uvicorn app.main:app --port 8082

cd ../frontend
npm install && npm run dev    # http://localhost:5176
```

Environment variables: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (any OpenAI-compatible endpoint, e.g. SiliconFlow), `LLM_MODEL` (needs solid function calling — DeepSeek-V3 or GPT-4o level), `CORS_ALLOWED_ORIGINS`.

## API overview

| Method | Path | Description |
|---|---|---|
| POST | `/api/datasets` | CSV/Excel upload → id + schema + preview |
| POST | `/api/analyses` | dataset + question → SSE (`session`, `stream-token`, `tool`, `report`, `done`) |
| GET/DELETE | `/api/analyses/{id}` | fetch / delete a past analysis |
| GET | `/api/analyses/{id}/files/{name}` | chart / export files |
