# Intelligent Invoice Processing & Reconciliation Agent

> Submission for the Real-World Coding Assessment — FinFlow Inc.
> Domain: FinTech · Category: LLM Integration + REST API + Business Logic

An API-driven agent that ingests vendor invoices (PDF / image / text / JSON),
uses Gemini to extract structured fields, validates them, matches against a
mock Purchase Order dataset, detects anomalies, and emits a JSON
reconciliation report.

---

## TL;DR — Quick Start (Docker)

```bash
git clone https://github.com/reddy0304/wipro-project-assement.git
cd wipro-project-assement
cp .env.example .env             # then paste your GEMINI_API_KEY into .env
docker compose up --build
```

Open <http://localhost:3000/> and you're running. Get a free Gemini key in
under a minute at <https://aistudio.google.com/app/apikey>.

Prefer native Node? See [§3 Path B](#path-b--native-node-for-development).

> Want to see all three reconciliation outcomes (MATCHED / PARTIAL /
> FAILED) without uploading anything? Run `.\demo\run-demo.ps1` (Windows)
> or `bash demo/run-demo.sh` (Mac/Linux). The full demo walkthrough is in
> [`demo/DEMO_SCRIPT.md`](./demo/DEMO_SCRIPT.md).

---

## 1 · Tech Stack

| Concern | Choice |
|---|---|
| Language | **TypeScript** (Node.js 20+) |
| Framework | **Express 5** |
| LLM | **Google Gemini** (`gemini-2.0-flash` via `@google/genai`) with optional OpenAI fallback |
| Validation | **Zod** (Pydantic-style runtime schemas) |
| File parsing | `pdf-parse` for PDFs; Gemini multimodal for images |
| Retry / fallback | `p-retry` with exponential backoff + cross-provider failover |
| Testing | **Vitest** |
| Containerization | Multi-stage Docker + `docker-compose` |

---

## 2 · Architecture (FR-1 → FR-7)

```
                       ┌───────────────────────────────────────────────────────┐
                       │                  Express REST API (FR-7)              │
                       │  POST /upload   POST /reconcile/:id   GET /report/:id │
                       └───────────────────────────────────────────────────────┘
                                              │
            multipart file  ───────► [ Ingestion (FR-1) ] ◄──── raw JSON body
                                              │
                                              ▼
                                  [ LLM Extractor (FR-2) ]
                                  Gemini structured output
                              + p-retry + OpenAI fallback (bonus)
                                              │
                                              ▼
                                   [ Validator (FR-3) ]
                                  Zod + ISO date / 4217 / >0
                                              │
                                              ▼
                                   [ PO Matcher (FR-4) ]
                              mock_data/purchase_orders.json
                                              │
                                              ▼
                                 [ Anomaly Detector (FR-5) ]
                          variance >5% · missing PO · duplicate inv#
                                              │
                                              ▼
                                  [ Reconciler (FR-6) ]
                              composes ReconciliationReport
                              status: MATCHED / PARTIAL / FAILED
```

Each step is a separate module under `src/services/` so they can be unit-tested
in isolation. State is held in an in-memory `sessionStore` keyed by `invoice_id`
— swap in a database by re-implementing that single interface.

### Project Layout

```
src/
├── index.ts                  # Express bootstrap
├── config.ts                 # Env vars
├── routes/                   # POST /upload, POST /reconcile/:id, GET /report/:id
├── services/                 # ingestion, llmExtractor, validator, poMatcher, anomalyDetector, reconciler
├── schemas/invoice.ts        # Zod schemas (single source of truth)
└── storage/sessionStore.ts   # In-memory state
mock_data/purchase_orders.json
public/index.html             # Simple demo UI (bonus)
tests/                        # Vitest unit tests
demo/                         # Evaluator demo assets (5 sample invoices + runner scripts + script)
```

---

## 3 · Setup

There are two ways to run this project. Pick **one**:

| Path | Best for | Requires |
|---|---|---|
| **A. Docker (recommended)** | Reviewers, evaluators — zero local toolchain | Docker Desktop |
| **B. Native Node** | Active development, hot-reload | Node.js >= 20 |

In both cases you need a free Gemini API key from <https://aistudio.google.com/app/apikey>.

### Step 0 · Clone and configure secrets (both paths)

```bash
git clone https://github.com/reddy0304/wipro-project-assement.git
cd wipro-project-assement
cp .env.example .env       # Windows PowerShell: copy .env.example .env
# Open .env in any editor and paste your GEMINI_API_KEY value.
```

> `.env` is git-ignored — your key never leaves your machine.

---

### Path A · Docker (one-command startup)

**Prerequisites:** Docker Desktop running. ([Download Docker Desktop](https://www.docker.com/products/docker-desktop/) for Windows/Mac/Linux.)

```bash
docker compose up --build
```

That single command will:

1. Pull the `node:22-alpine` base image
2. Build the TypeScript code inside a throwaway "builder" stage
3. Copy the compiled `dist/` into a slim production image
4. Start the container, reading `GEMINI_API_KEY` (and the other vars) from your local `.env` file
5. Expose the API on **http://localhost:3000**

When you see this log line, it's ready:

```
[server] Invoice Reconciliation Agent listening on :3000
```

Open <http://localhost:3000/> in your browser to use the demo UI.

#### Useful Docker commands

```bash
docker compose up -d            # Start in detached (background) mode
docker compose logs -f          # Tail the container logs
docker compose ps               # Show container status (healthy / unhealthy)
docker compose restart          # Restart after a config change
docker compose down             # Stop and remove the container + network
docker compose up --build -d    # Rebuild image after code changes, then start
```

#### What is `docker-compose.yml`?

`docker-compose.yml` is the deployment recipe. Instead of typing a long `docker run` command with a dozen flags, Compose reads this file and runs the equivalent for you. Here is ours, annotated:

```yaml
services:
  invoice-agent:                   # service name (used by `docker compose logs invoice-agent`)
    build: .                       # build an image from the Dockerfile in this folder
    container_name: invoice-reconciliation-agent
    ports:
      - "3000:3000"                # map host port 3000 -> container port 3000
    environment:                   # env vars passed into the container at runtime
      - PORT=3000
      - GEMINI_API_KEY=${GEMINI_API_KEY}                       # read from your local .env
      - GEMINI_MODEL=${GEMINI_MODEL:-gemini-2.0-flash}         # ${VAR:-default} = use default if unset
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - OPENAI_MODEL=${OPENAI_MODEL:-gpt-4o-mini}
      - LLM_MAX_RETRIES=${LLM_MAX_RETRIES:-3}
      - LLM_RETRY_BASE_MS=${LLM_RETRY_BASE_MS:-500}
    restart: unless-stopped        # auto-restart if the container crashes
```

The companion `Dockerfile` is multi-stage:
- **Stage 1 (`builder`)** installs *all* dependencies and runs `tsc` to produce `dist/`.
- **Stage 2 (`runtime`)** installs only production deps and copies `dist/` from stage 1.
This keeps the final image small (~150 MB instead of ~400 MB) and free of dev tools.

#### Docker troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` | Something else is using port 3000. Kill it, or change the host side: `"3001:3000"` in `docker-compose.yml`, then visit `http://localhost:3001`. |
| `failed to connect to the docker API` | Docker Desktop isn't running. Start it and wait ~30s for the daemon. |
| `Missing required env var: GEMINI_API_KEY` | You forgot to create `.env` from `.env.example`, or your shell isn't picking it up. Compose auto-reads `.env` in the same directory. |
| Container marked `unhealthy` | Tail logs: `docker compose logs -f`. Usually a bad API key. |

---

### Path B · Native Node (for development)

**Prerequisites:** Node.js **>= 20** and npm.

```bash
npm install
npm run dev            # hot-reload via tsx --watch
# → http://localhost:3000
```

Production-style local run (no watcher):

```bash
npm run build          # compile TypeScript -> dist/
npm start              # node dist/index.js
```

Run the test suite:

```bash
npm test               # 18 unit tests for FR-3 / FR-4 / FR-5 / FR-6
```

---

## 4 · Environment Variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | **yes** | — | Google AI Studio key |
| `GEMINI_MODEL` | no | `gemini-2.0-flash` | Override model |
| `OPENAI_API_KEY` | no | — | Enables fallback if Gemini fails all retries |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | Fallback model |
| `PORT` | no | `3000` | HTTP port |
| `LLM_MAX_RETRIES` | no | `3` | Retry attempts before fallback/give-up |
| `LLM_RETRY_BASE_MS` | no | `500` | Exponential backoff base delay |

---

## 5 · REST API

### `POST /upload`

Accepts **either**:
- `multipart/form-data` with field `file` (PDF / PNG / JPG / TXT), **or**
- `application/json` matching the extracted-invoice schema (skips the LLM).

Returns the full reconciliation report.

**Sample — file upload:**

```bash
curl -X POST http://localhost:3000/upload \
  -F "file=@/path/to/invoice.pdf"
```

**Sample — raw JSON:**

```bash
curl -X POST http://localhost:3000/upload \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_name": "Acme Industrial Supplies",
    "invoice_number": "INV-2026-0429",
    "invoice_date": "2026-04-29",
    "line_items": [
      { "description": "Hex bolts M8",    "qty": 1000, "unit_price": 0.45  },
      { "description": "Steel plates 4mm","qty": 200,  "unit_price": 20.25 }
    ],
    "total_amount": 4500,
    "currency": "USD",
    "po_reference": "PO-1001"
  }'
```

### `POST /reconcile/:invoiceId`

Re-runs the validation + PO match + anomaly detection pipeline for a stored
invoice. Optionally accepts a JSON body to override the extracted data
(useful for manual corrections).

```bash
curl -X POST http://localhost:3000/reconcile/<invoice_id>
```

### `GET /report/:invoiceId`

Retrieves the stored reconciliation report.

```bash
curl http://localhost:3000/report/<invoice_id>
```

### `GET /health`

Liveness probe (used by Docker healthcheck).

---

## 6 · Sample Response Shape (`ReconciliationReport`)

```jsonc
{
  "invoice_id": "0e9c1a4d-...-...",
  "extracted_data": {
    "vendor_name": "Acme Industrial Supplies",
    "invoice_number": "INV-2026-0429",
    "invoice_date": "2026-04-29",
    "line_items": [ /* ... */ ],
    "total_amount": 4500,
    "currency": "USD",
    "po_reference": "PO-1001"
  },
  "validation_status": {
    "ok": true,
    "fields": [
      { "field": "vendor_name",    "ok": true },
      { "field": "invoice_number", "ok": true },
      { "field": "invoice_date",   "ok": true },
      { "field": "total_amount",   "ok": true },
      { "field": "currency",       "ok": true },
      { "field": "line_items",     "ok": true }
    ]
  },
  "matched_po": {
    "po_reference": "PO-1001",
    "vendor_name":  "Acme Industrial Supplies",
    "po_value":     4500.00,
    "currency":     "USD",
    "issued_date":  "2026-01-10"
  },
  "anomalies": [],
  "reconciliation_status": "MATCHED",
  "created_at": "2026-05-13T06:30:00.000Z"
}
```

### Reconciliation status policy

| Status | Meaning |
|---|---|
| `MATCHED` | Validation passed, PO matched, zero anomalies |
| `PARTIAL` | Validation passed, PO matched, only warning-level anomalies present |
| `FAILED`  | Validation failed **or** no PO match **or** any `critical` anomaly |

### Anomaly codes

| Code | When |
|---|---|
| `AMOUNT_VARIANCE_GT_5_PCT` | `|invoice.total − po.value| / po.value > 0.05` |
| `MISSING_OR_UNMATCHED_PO_REFERENCE` | `po_reference` is null or not in dataset |
| `DUPLICATE_INVOICE_NUMBER` | `invoice_number` already processed in this session |
| `CURRENCY_MISMATCH_VS_PO` | Invoice currency ≠ PO currency (bonus signal) |

---

## 7 · How the Bonus Items Are Implemented

| Bonus | Where |
|---|---|
| **Retry / fallback logic for LLM API failures** | `src/services/llmExtractor.ts` — `p-retry` w/ exponential backoff, optional OpenAI fallback when Gemini exhausts retries |
| **Docker + docker-compose for one-command startup** | `Dockerfile` (multi-stage build) + `docker-compose.yml` |
| **Simple UI to upload & view reports** | `public/index.html` — served from `/` |
| **Unit tests for validation and reconciliation logic** | `tests/validator.test.ts`, `tests/reconciler.test.ts` (10 + 8 cases) |

(Streaming via SSE was intentionally skipped — the full pipeline returns a
structured JSON report in a single response, which is the more useful shape
for downstream AP automation.)

---

## 8 · Design Notes

- **`po_reference` missing is an anomaly, not a validation error.** This keeps
  the pipeline moving and surfaces *why* a reconciliation failed in a single
  structured report rather than crashing the request.
- **The LLM is constrained with `responseSchema`** so it must emit JSON of the
  expected shape — no fragile prose parsing.
- **`temperature: 0`** on Gemini for deterministic extractions.
- **Currencies are normalized to uppercase ISO-4217** before validation so the
  LLM's casing doesn't cause spurious failures.
- **Duplicate detection is session-scoped** (per FR-5(c)). In production this
  would be a persistent unique index on `(vendor_name, invoice_number)`.

---

## 9 · Repository

GitHub: <https://github.com/reddy0304/wipro-project-assement>
