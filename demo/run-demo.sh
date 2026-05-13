#!/usr/bin/env bash
# =========================================================================
# FinFlow Invoice Reconciliation Agent — End-to-end demo runner (Mac/Linux)
# =========================================================================
# Hits all three REST endpoints (FR-7) with the five demo invoices in this
# folder. Exercises FR-1, FR-3, FR-4, FR-5, FR-6 without needing a live LLM.
#
# Usage (server must be running on :3000):
#   bash demo/run-demo.sh
#
# Requires `jq` for pretty-printing. Falls back to raw JSON if not installed.
# =========================================================================
set -euo pipefail

BASE="http://localhost:3000"
DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JQ=$(command -v jq || true)

# ANSI colors
C_CYAN='\033[1;36m'; C_YEL='\033[1;33m'; C_GRN='\033[1;32m'; C_RED='\033[1;31m'
C_DIM='\033[2m'; C_RST='\033[0m'

hr() { printf "${C_DIM}%.0s-" {1..78}; printf "${C_RST}\n"; }
section() { echo; hr; printf "${C_CYAN}%s${C_RST}\n" "$1"; hr; }

post_invoice() {
  local label="$1"; local file="$2"
  echo; printf "${C_YEL}=== %s ===${C_RST}\n" "$label"
  printf "${C_DIM}POST %s/upload  <-  %s${C_RST}\n" "$BASE" "$(basename "$file")"
  local res
  res=$(curl -fsS -X POST "$BASE/upload" -H "Content-Type: application/json" --data-binary "@$file")
  local status
  if [ -n "$JQ" ]; then
    status=$(echo "$res" | jq -r '.reconciliation_status')
    local invoice_id; invoice_id=$(echo "$res" | jq -r '.invoice_id')
    case "$status" in
      MATCHED) printf "reconciliation_status : ${C_GRN}%s${C_RST}\n" "$status" ;;
      PARTIAL) printf "reconciliation_status : ${C_YEL}%s${C_RST}\n" "$status" ;;
      FAILED)  printf "reconciliation_status : ${C_RED}%s${C_RST}\n" "$status" ;;
      *)       printf "reconciliation_status : %s\n"                "$status" ;;
    esac
    printf "${C_DIM}invoice_id            : %s${C_RST}\n" "$invoice_id"
    local anomaly_count; anomaly_count=$(echo "$res" | jq -r '.anomalies | length')
    if [ "$anomaly_count" != "0" ]; then
      echo "$res" | jq -r '.anomalies[] | "  [" + .severity + "] " + .code + "\n       " + .message'
    else
      printf "${C_GRN}anomalies             : (none)${C_RST}\n"
    fi
    LAST_ID="$invoice_id"
  else
    echo "$res"
  fi
}

section "0. Health check (FR-7)"
curl -fsS "$BASE/health"; echo

section "1. POST /upload — MATCHED happy path"
post_invoice "MATCHED case (PO-1001 USD 4500 = invoice USD 4500)" \
             "$DEMO_DIR/01-matched.json"
ID1="$LAST_ID"

section "2. POST /upload — PARTIAL (currency mismatch, warning only)"
post_invoice "PARTIAL case (PO-1001 USD vs invoice EUR)" \
             "$DEMO_DIR/02-partial-currency-mismatch.json"

section "3. POST /upload — FAILED with AMOUNT_VARIANCE_GT_5_PCT"
post_invoice "FAILED case (invoice 6450 USD vs PO 4500 = 43%)" \
             "$DEMO_DIR/03-failed-variance.json"
ID3="$LAST_ID"

section "4. POST /upload — FAILED with MISSING_OR_UNMATCHED_PO_REFERENCE"
post_invoice "FAILED case (po_reference not in dataset)" \
             "$DEMO_DIR/04-failed-missing-po.json"

section "5. POST /upload — FAILED validation (bad currency + bad date)"
post_invoice "FAILED case (currency='DOLLARS', date='01/05/2026')" \
             "$DEMO_DIR/05-failed-validation.json"

section "6. GET /report/:invoiceId — retrieve a stored report"
echo "GET $BASE/report/$ID1"
curl -fsS "$BASE/report/$ID1" | { [ -n "$JQ" ] && jq '.reconciliation_status' || cat; }

section "7. POST /reconcile/:invoiceId — re-run pipeline"
echo "POST $BASE/reconcile/$ID3"
curl -fsS -X POST "$BASE/reconcile/$ID3" -H "Content-Type: application/json" -d '{}' \
  | { [ -n "$JQ" ] && jq '.reconciliation_status' || cat; }

section "8. POST /upload — duplicate detection"
echo "Submitting INV-DEMO-MATCHED-001 a second time…"
post_invoice "Duplicate of MATCHED invoice" \
             "$DEMO_DIR/01-matched.json"

hr
printf "${C_GRN}Demo complete.${C_RST}\n"
hr
