# `demo/` — Evaluator demo assets

Everything in this folder is for the live demo / evaluator walkthrough.
None of these files are loaded by the application itself.

| File | Purpose |
|---|---|
| `01-matched.json` | MATCHED happy path (PO-1001 USD 4500) |
| `02-partial-currency-mismatch.json` | PARTIAL — only a warning-level currency-mismatch anomaly |
| `03-failed-variance.json` | FAILED — 43% amount variance vs PO (FR-5a) |
| `04-failed-missing-po.json` | FAILED — `po_reference` not in dataset (FR-5b) |
| `05-failed-validation.json` | FAILED — bad currency code + non-ISO date (FR-3) |
| `sample-llm-pdf-extraction.json` | Captured Gemini extraction — use as offline backup when the LLM is rate-limited |
| `sample-llm-retry-log.txt` | Captured terminal output that proves the retry/fallback bonus works |
| `run-demo.ps1` | One-shot Windows demo runner — hits every endpoint with every demo file |
| `run-demo.sh` | Mac/Linux equivalent (requires `jq` for pretty output) |
| `DEMO_SCRIPT.md` | Step-by-step rehearsal script with what to say at each step |

## Quick demo

With the server running on :3000:

```powershell
# Windows
.\demo\run-demo.ps1
```

```bash
# Mac / Linux
bash demo/run-demo.sh
```

## Manual demo

Open <http://localhost:3000/>, then paste each `.json` file in this folder
into the textarea and hit **Reconcile JSON**. You'll see all three
reconciliation statuses (MATCHED, PARTIAL, FAILED) plus the duplicate-
detection case when you submit `01-matched.json` twice.
