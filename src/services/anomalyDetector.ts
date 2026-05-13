import {
  AnomalyCodes,
  type Anomaly,
  type ExtractedInvoice,
  type PurchaseOrder,
} from "../schemas/invoice";
import { sessionStore } from "../storage/sessionStore";

/**
 * FR-5: Anomaly Detection.
 *
 * Required anomaly checks:
 *   (a) amount variance > 5% vs PO value  -> CRITICAL
 *   (b) missing / unmatched PO reference  -> WARNING (or CRITICAL if absent)
 *   (c) duplicate invoice_number within session -> CRITICAL
 *
 * Bonus check:
 *   (d) currency mismatch between invoice and PO -> WARNING
 */

const VARIANCE_THRESHOLD = 0.05;

export function detectAnomalies(args: {
  invoice: ExtractedInvoice;
  matchedPO: PurchaseOrder | null;
}): Anomaly[] {
  const { invoice, matchedPO } = args;
  const anomalies: Anomaly[] = [];

  // (c) Duplicate invoice_number within session.
  if (sessionStore.hasSeenInvoiceNumber(invoice.invoice_number)) {
    anomalies.push({
      code: AnomalyCodes.DUPLICATE_INVOICE,
      severity: "critical",
      message: `Invoice number "${invoice.invoice_number}" has already been processed in this session.`,
      context: { invoice_number: invoice.invoice_number },
    });
  }

  // (b) Missing / unmatched PO reference.
  if (!invoice.po_reference) {
    anomalies.push({
      code: AnomalyCodes.MISSING_PO,
      severity: "critical",
      message: "Invoice has no po_reference. Cannot reconcile against a Purchase Order.",
    });
  } else if (!matchedPO) {
    anomalies.push({
      code: AnomalyCodes.MISSING_PO,
      severity: "critical",
      message: `po_reference "${invoice.po_reference}" was not found in the Purchase Order dataset.`,
      context: { po_reference: invoice.po_reference },
    });
  } else {
    // (a) Amount variance > 5%.
    const variance = Math.abs(invoice.total_amount - matchedPO.po_value) / matchedPO.po_value;
    if (variance > VARIANCE_THRESHOLD) {
      anomalies.push({
        code: AnomalyCodes.AMOUNT_VARIANCE,
        severity: "critical",
        message: `Invoice total ${invoice.total_amount.toFixed(2)} differs from PO value ${matchedPO.po_value.toFixed(2)} by ${(variance * 100).toFixed(2)}% (threshold 5%).`,
        context: {
          invoice_total: invoice.total_amount,
          po_value: matchedPO.po_value,
          variance_pct: Number((variance * 100).toFixed(2)),
        },
      });
    }

    // (d) Currency mismatch (bonus signal).
    if (invoice.currency !== matchedPO.currency) {
      anomalies.push({
        code: AnomalyCodes.CURRENCY_MISMATCH,
        severity: "warning",
        message: `Invoice currency ${invoice.currency} does not match PO currency ${matchedPO.currency}.`,
        context: {
          invoice_currency: invoice.currency,
          po_currency: matchedPO.currency,
        },
      });
    }
  }

  return anomalies;
}
