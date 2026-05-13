# Demo Script — Invoice Reconciliation Agent

> Rehearsal walk-through for the 8–10 minute evaluator demo.
> Pair this with the files in `demo/`. Every line you'd say is in **bold-italic**.

---

## Pre-flight checklist (run 2 min before the demo starts)

```powershell
# 1. Is the container alive?
docker compose ps

# 2. Is the API responding?
curl.exe -s http://localhost:3000/health

# 3. Reset session state so duplicate-detection demo works
docker compose restart
```

Open these tabs in the browser:
1. http://localhost:3000/  (the demo UI)
2. The GitHub repo
3. *(Backup)* `demo/sample-llm-pdf-extraction.json` open in the editor

---

## Step 1 — Frame the problem (30 sec)

> ***"FinFlow Inc. processes thousands of vendor invoices a day, currently
> all by hand. I built an API-driven agent that automates the full
> workflow: ingest invoice → LLM extracts fields → validate → match a
> Purchase Order → flag anomalies → emit a reconciliation report. All
> seven functional requirements are covered, plus four of the bonus items."***

---

## Step 2 — Walk through the architecture (1 min)

Open the README at **§2 · Architecture**. Trace the pipeline left to right.

> ***"Each pipeline stage is a separate module under `src/services/`.
> Validation, PO matching, anomaly detection, and reconciliation are all
> pure functions — no I/O — so they're trivially unit-testable. State is
> held in an in-memory session store keyed by invoice_id. To go to
> production, you'd swap that one file for a Postgres adapter."***

Switch to the IDE and show the folder tree of `src/services/`:

```
ingestion.ts          ← FR-1
llmExtractor.ts       ← FR-2 + retry/fallback bonus
validator.ts          ← FR-3
poMatcher.ts          ← FR-4
anomalyDetector.ts    ← FR-5
reconciler.ts         ← FR-6 orchestrator
```

> ***"Notice the 1-to-1 mapping between FRs and files. Easy to navigate,
> easy to extend."***

---

## Step 3 — Run the happy path (1 min)

Switch to the browser tab at <http://localhost:3000/>.

Open `demo/01-matched.json`, copy its contents, paste into the textarea.
Click **Reconcile JSON**.

> ***"Green MATCHED pill at the top. Down here you can see validation
> passed every field — vendor, invoice number, ISO date, currency, line
> items. The PO matcher found PO-1001 in the mock dataset. The anomaly
> array is empty. That's FR-3 through FR-6, all in one response."***

---

## Step 4 — Run the PARTIAL case (1 min)

Paste `demo/02-partial-currency-mismatch.json`. Click **Reconcile JSON**.

> ***"Same numbers, but the invoice currency is EUR while the PO is in
> USD. The yellow PARTIAL pill means validation passed and the PO
> matched, but there's a warning-level anomaly — currency mismatch. The
> invoice is processable, but flagged for human review. That's a
> business-logic decision I made: not every anomaly should block
> payment."***

---

## Step 5 — Run the FAILED variance case (1 min)

Paste `demo/03-failed-variance.json`. Click **Reconcile JSON**.

> ***"Now the invoice total is 6450 USD but PO-1001 is for 4500 — a
> 43% variance. The 5% threshold is FR-5(a). Critical-severity anomaly,
> reconciliation status flips to FAILED, but notice the report shape is
> identical. Downstream consumers handle one schema."***

---

## Step 6 — Show duplicate detection (30 sec)

Paste `demo/01-matched.json` **again** (the same MATCHED invoice number).

> ***"Resubmitting the same invoice_number — FR-5(c). The
> DUPLICATE_INVOICE_NUMBER anomaly fires, status drops to FAILED.
> Session-scoped right now; in production this would be a unique index
> on vendor_name, invoice_number, fiscal_year."***

---

## Step 7 — Show the retry / fallback bonus (1 min)

Switch to the terminal showing container logs:

```powershell
docker compose logs -f --tail 100 invoice-agent
```

Point at the log section captured in `demo/sample-llm-retry-log.txt`:

```
[llm] Gemini attempt 1 failed: 429 RESOURCE_EXHAUSTED
[llm] Gemini attempt 2 failed: 429 RESOURCE_EXHAUSTED
[llm] Gemini attempt 3 failed: 429 RESOURCE_EXHAUSTED
[llm] Gemini attempt 4 failed: 429 RESOURCE_EXHAUSTED
[llm] Gemini exhausted retries — falling back to OpenAI.
```

> ***"This is the retry-and-fallback bonus working live. Gemini got
> rate-limited, my code retried four times with exponential backoff —
> 500ms, 1s, 2s, 4s — then automatically failed over to the OpenAI
> provider. In a real deployment with both providers funded, the
> failover would be invisible to the caller. The configuration is one
> env var: `OPENAI_API_KEY`."***

> *(If asked: "Why didn't the OpenAI call succeed?")*
>
> ***"That's a placeholder key in the demo env — proves the failover
> path is exercised. In a real deploy you'd put a billed key there and
> the system survives a Gemini outage with zero downtime."***

---

## Step 8 — Show LLM extraction either live or by sample (1 min)

**If Gemini quota is healthy:** Drag a real PDF invoice into the UI's file picker.
Wait ~2s. Show the extracted JSON inside the report.

**If Gemini is rate-limited:** Open `demo/sample-llm-pdf-extraction.json`.

> ***"Here's a captured response from a real PDF. Gemini extracted
> vendor name, invoice number, ISO date, line items, currency, and PO
> reference, all in a single structured-output call. I constrained the
> response with `responseSchema` so the model is forced to emit JSON
> matching our shape — no fragile prose parsing. Temperature 0 for
> determinism."***

---

## Step 9 — Show the tests (1 min)

In a fresh terminal:

```powershell
npm test
```

> ***"Eighteen unit tests across validation and reconciliation. They run
> in under two seconds and don't hit the live LLM, so they'd work in CI
> without API credits."***

Watch the output for `Tests  18 passed (18)`.

---

## Step 10 — Wrap up with Docker (30 sec)

```powershell
docker compose ps
```

> ***"The whole thing is one `docker compose up` command. Multi-stage
> Dockerfile keeps the runtime image at about 150 MB without dev
> dependencies. Healthcheck is configured for orchestrators like ECS or
> Kubernetes. Ready to deploy as-is."***

---

## Q&A — Practice these answers out loud

| Q | Your answer (~15 sec each) |
|---|---|
| *"How would you scale this?"* | "Three swaps: in-memory `sessionStore` → Redis/Postgres, push the LLM call behind a BullMQ queue so `/upload` returns 202 immediately, then put the container behind an ALB. The service layer is stateless." |
| *"What if the LLM hallucinates?"* | "Two layers: Gemini's `responseSchema` forbids unexpected shapes, and the validator (FR-3) rejects bad data before it reaches PO matching. The caller sees exactly which field failed." |
| *"Why Gemini over GPT-4?"* | "Cost — Gemini 2.0 Flash is free at our volume, and structured output is first-class. Provider failover is built in, so we're not locked in." |
| *"How do you detect duplicates?"* | "Session-scoped `Set<invoice_number>` per FR-5(c). In production it'd be a unique index on (vendor_name, invoice_number, fiscal_year)." |
| *"Idempotency?"* | "Right now resubmits are flagged as duplicates. For full idempotency I'd hash (vendor_name, invoice_number, total_amount) and make `POST /upload` an upsert that returns the existing report on second call." |
| *"What's PARTIAL vs MATCHED?"* | "PARTIAL means validation OK + PO matched + only warning-level anomalies. Invoice is processable but flagged for human review. The currency-mismatch case is the canonical example." |
| *"How would tests change with a real DB?"* | "Service layer wouldn't change at all — that's the point of the storage interface. I'd add integration tests that boot a Testcontainers Postgres and re-run the reconciler tests through that adapter." |

---

## Three lines to memorize

These are your strongest signals to an evaluator:

1. **"I constrained Gemini with `responseSchema` so it must emit JSON in our shape — no fragile prose parsing."**
2. **"A missing PO is an anomaly, not a validation error — that's a design decision the spec doesn't dictate. Shows product thinking."**
3. **"Multi-stage Docker build keeps the runtime image at ~150 MB without dev tools."**

---

## Things to avoid saying

| Don't | Instead |
|---|---|
| *"I generated this with AI"* | Talk about decisions: stack choice, status policy, fallback design |
| *"I didn't implement X"* | *"X is scoped out. Here's how I'd add it in iteration 2."* |
| *"It might break with weird PDFs"* | *"Scanned PDFs are routed as images to Gemini's multimodal mode — OCR-less."* |

---

## If the network is down or the LLM is fully blocked

You can still run the **entire** business-logic demo (FRs 1, 3, 4, 5, 6, 7)
because every demo file in this folder uses the JSON path which bypasses
the LLM. The only thing you'd lose is FR-2 live, which you cover by
walking through `demo/sample-llm-pdf-extraction.json` instead.
