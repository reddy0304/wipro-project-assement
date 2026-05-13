import { v4 as uuidv4 } from "uuid";
import type {
  Anomaly,
  ExtractedInvoice,
  PurchaseOrder,
  ReconciliationReport,
  ReconciliationStatusT,
} from "../schemas/invoice";
import { detectAnomalies } from "./anomalyDetector";
import { findByReference } from "./poMatcher";
import { validateExtractedInvoice } from "./validator";
import type { RawLlmInvoice } from "../schemas/invoice";
import { sessionStore } from "../storage/sessionStore";

/**
 * FR-6: Reconciliation Report orchestrator.
 *
 * Pipeline: validate (FR-3) -> match PO (FR-4) -> detect anomalies (FR-5)
 *           -> compose reconciliation_status (FR-6).
 *
 * Status policy:
 *   MATCHED  : validation OK, PO matched, zero critical anomalies
 *   PARTIAL  : validation OK, PO matched, has anomalies but none block payment
 *              (e.g. only currency-mismatch warnings, or duplicate flagged)
 *   FAILED   : validation failed OR no PO OR critical variance > 5%
 */

function decideStatus(args: {
  validationOk: boolean;
  matchedPO: PurchaseOrder | null;
  anomalies: Anomaly[];
}): ReconciliationStatusT {
  const { validationOk, matchedPO, anomalies } = args;
  if (!validationOk) return "FAILED";
  if (!matchedPO) return "FAILED";

  const hasCritical = anomalies.some((a) => a.severity === "critical");
  if (hasCritical) return "FAILED";

  return anomalies.length > 0 ? "PARTIAL" : "MATCHED";
}

export interface ReconcileInput {
  invoice_id?: string;
  raw_extracted: RawLlmInvoice;
}

export function reconcile(input: ReconcileInput): ReconciliationReport {
  const invoice_id = input.invoice_id ?? uuidv4();
  const validation = validateExtractedInvoice(input.raw_extracted);

  let matchedPO: PurchaseOrder | null = null;
  let anomalies: Anomaly[] = [];
  let extractedForReport: unknown = input.raw_extracted;

  if (validation.ok && validation.clean) {
    const invoice: ExtractedInvoice = validation.clean;
    matchedPO = findByReference(invoice.po_reference);
    anomalies = detectAnomalies({ invoice, matchedPO });

    // Mark this invoice_number as seen AFTER duplicate-check has already run
    // inside detectAnomalies, so the duplicate signal fires on the *next*
    // submission of the same number — per FR-5(c).
    sessionStore.markInvoiceNumberSeen(invoice.invoice_number);

    extractedForReport = invoice;
  } else {
    // Validation failed — record the raw extraction so the caller can see
    // exactly what the LLM produced and which fields broke.
    extractedForReport = input.raw_extracted;
  }

  const reconciliation_status = decideStatus({
    validationOk: validation.ok,
    matchedPO,
    anomalies,
  });

  const report: ReconciliationReport = {
    invoice_id,
    extracted_data: extractedForReport,
    validation_status: { ok: validation.ok, fields: validation.fields },
    matched_po: matchedPO,
    anomalies,
    reconciliation_status,
    created_at: new Date().toISOString(),
  };

  return report;
}
