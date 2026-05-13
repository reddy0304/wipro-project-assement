# =========================================================================
# FinFlow Invoice Reconciliation Agent — End-to-end demo runner (Windows)
# =========================================================================
# Hits all three REST endpoints (FR-7) with the five demo invoices in this
# folder. Exercises FR-1, FR-3, FR-4, FR-5, FR-6 without needing a live LLM.
#
# Usage (server must be running on :3000):
#   pwsh demo\run-demo.ps1
#   # or simply:  .\demo\run-demo.ps1
# =========================================================================

$ErrorActionPreference = "Stop"
$base = "http://localhost:3000"
$demoDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Hr { Write-Host "" -ForegroundColor DarkGray; Write-Host ("-" * 78) -ForegroundColor DarkGray }
function Section($msg) { Hr; Write-Host $msg -ForegroundColor Cyan; Hr }

function Post-Invoice($label, $file) {
    Write-Host ""
    Write-Host "=== $label ===" -ForegroundColor Yellow
    Write-Host ("POST {0}/upload   <-   {1}" -f $base, (Split-Path -Leaf $file)) -ForegroundColor DarkGray
    $body = Get-Content $file -Raw
    $res  = Invoke-RestMethod -Uri "$base/upload" -Method Post -ContentType "application/json" -Body $body
    $statusColor = switch ($res.reconciliation_status) {
        "MATCHED" { "Green" }
        "PARTIAL" { "Yellow" }
        "FAILED"  { "Red" }
        default   { "White" }
    }
    Write-Host ("reconciliation_status : {0}" -f $res.reconciliation_status) -ForegroundColor $statusColor
    Write-Host ("invoice_id            : {0}" -f $res.invoice_id) -ForegroundColor DarkGray
    if ($res.anomalies.Count -gt 0) {
        Write-Host "anomalies             :" -ForegroundColor DarkGray
        foreach ($a in $res.anomalies) {
            Write-Host ("  [{0}] {1}" -f $a.severity, $a.code) -ForegroundColor Red
            Write-Host ("       {0}" -f $a.message)             -ForegroundColor DarkGray
        }
    } else {
        Write-Host "anomalies             : (none)" -ForegroundColor DarkGreen
    }
    return $res.invoice_id
}

# ---------------------------------------------------------------------------
Section "0. Health check (FR-7)"
$health = Invoke-RestMethod -Uri "$base/health" -Method Get
Write-Host ("Server up: {0}" -f ($health | ConvertTo-Json -Compress)) -ForegroundColor Green

# ---------------------------------------------------------------------------
Section "1. POST /upload - MATCHED happy path (FR-3/4/5/6 all green)"
$id1 = Post-Invoice "MATCHED case (PO-1001 USD 4500 = invoice USD 4500)" `
                    "$demoDir\01-matched.json"

Section "2. POST /upload - PARTIAL (currency mismatch, warning only)"
$id2 = Post-Invoice "PARTIAL case (PO-1001 USD vs invoice EUR)" `
                    "$demoDir\02-partial-currency-mismatch.json"

Section "3. POST /upload - FAILED with AMOUNT_VARIANCE_GT_5_PCT"
$id3 = Post-Invoice "FAILED case (invoice 6450 USD vs PO 4500 = 43%)" `
                    "$demoDir\03-failed-variance.json"

Section "4. POST /upload - FAILED with MISSING_OR_UNMATCHED_PO_REFERENCE"
$id4 = Post-Invoice "FAILED case (po_reference not in dataset)" `
                    "$demoDir\04-failed-missing-po.json"

Section "5. POST /upload - FAILED validation (bad currency + bad date)"
$id5 = Post-Invoice "FAILED case (bad currency code and non-ISO date)" `
                    "$demoDir\05-failed-validation.json"

# ---------------------------------------------------------------------------
Section "6. GET /report/:invoiceId - retrieve a stored report"
Write-Host ("GET {0}/report/{1}" -f $base, $id1) -ForegroundColor DarkGray
$r = Invoke-RestMethod -Uri "$base/report/$id1" -Method Get
Write-Host ("Retrieved report status: {0}" -f $r.reconciliation_status) -ForegroundColor Green

# ---------------------------------------------------------------------------
Section "7. POST /reconcile/:invoiceId - re-run pipeline on an existing invoice"
Write-Host ("POST {0}/reconcile/{1}" -f $base, $id3) -ForegroundColor DarkGray
$rr = Invoke-RestMethod -Uri "$base/reconcile/$id3" -Method Post -ContentType "application/json" -Body "{}"
Write-Host ("Re-reconciled status   : {0}" -f $rr.reconciliation_status) -ForegroundColor Yellow
Write-Host ("(Same result expected since underlying data is unchanged.)") -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
Section "8. POST /upload - duplicate detection (resubmit MATCHED invoice)"
Write-Host "Submitting INV-DEMO-MATCHED-001 a second time..." -ForegroundColor DarkGray
$dup = Invoke-RestMethod -Uri "$base/upload" -Method Post -ContentType "application/json" `
       -Body (Get-Content "$demoDir\01-matched.json" -Raw)
Write-Host ("Duplicate-resubmit status: {0}" -f $dup.reconciliation_status) -ForegroundColor Red
$dupAnomaly = $dup.anomalies | Where-Object { $_.code -eq "DUPLICATE_INVOICE_NUMBER" }
if ($dupAnomaly) {
    Write-Host ("  DUPLICATE_INVOICE_NUMBER detected: {0}" -f $dupAnomaly.message) -ForegroundColor Red
}

Hr
Write-Host "Demo complete." -ForegroundColor Green
Hr
