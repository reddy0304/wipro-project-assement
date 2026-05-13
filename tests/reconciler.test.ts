import { beforeEach, describe, expect, it } from "vitest";
import { reconcile } from "../src/services/reconciler";
import { sessionStore } from "../src/storage/sessionStore";
import { AnomalyCodes, type RawLlmInvoice } from "../src/schemas/invoice";

/**
 * Tests for FR-4 / FR-5 / FR-6. The mock PO dataset is loaded from disk
 * (mock_data/purchase_orders.json) at runtime — we use PO-1001 (USD 4500)
 * and PO-1005 (USD 78000) as fixtures.
 */

function rawInvoice(overrides: Partial<RawLlmInvoice> = {}): RawLlmInvoice {
  return {
    vendor_name: "Acme Industrial Supplies",
    invoice_number: "INV-AUTO-" + Math.random().toString(36).slice(2, 8),
    invoice_date: "2026-04-29",
    line_items: [
      { description: "Hex bolts M8", qty: 1000, unit_price: 0.45 },
      { description: "Steel plates 4mm", qty: 200, unit_price: 20.25 },
    ],
    total_amount: 4500,
    currency: "USD",
    po_reference: "PO-1001",
    ...overrides,
  };
}

describe("FR-4 / FR-5 / FR-6: reconcile()", () => {
  beforeEach(() => sessionStore._reset());

  it("MATCHED when validation OK, PO found, no anomalies", () => {
    const report = reconcile({ raw_extracted: rawInvoice() });
    expect(report.reconciliation_status).toBe("MATCHED");
    expect(report.matched_po?.po_reference).toBe("PO-1001");
    expect(report.anomalies).toHaveLength(0);
    expect(report.validation_status.ok).toBe(true);
  });

  it("FAILED when validation fails (e.g. bad currency)", () => {
    const report = reconcile({
      raw_extracted: rawInvoice({ currency: "DOLLARS" as any }),
    });
    expect(report.reconciliation_status).toBe("FAILED");
    expect(report.validation_status.ok).toBe(false);
  });

  it("FAILED with MISSING_PO anomaly when po_reference is null", () => {
    const report = reconcile({
      raw_extracted: rawInvoice({ po_reference: null }),
    });
    expect(report.reconciliation_status).toBe("FAILED");
    expect(report.anomalies.some((a) => a.code === AnomalyCodes.MISSING_PO)).toBe(true);
  });

  it("FAILED with MISSING_PO anomaly when po_reference does not match dataset", () => {
    const report = reconcile({
      raw_extracted: rawInvoice({ po_reference: "PO-9999-UNKNOWN" }),
    });
    expect(report.reconciliation_status).toBe("FAILED");
    expect(report.anomalies.some((a) => a.code === AnomalyCodes.MISSING_PO)).toBe(true);
  });

  it("FAILED with AMOUNT_VARIANCE when invoice total is >5% off PO value", () => {
    // PO-1001 value = 4500 USD. 4800 = +6.67% variance.
    const report = reconcile({
      raw_extracted: rawInvoice({ total_amount: 4800 }),
    });
    expect(report.anomalies.some((a) => a.code === AnomalyCodes.AMOUNT_VARIANCE)).toBe(true);
    expect(report.reconciliation_status).toBe("FAILED");
  });

  it("MATCHED when invoice total is within 5% of PO value", () => {
    // 4700 vs 4500 = 4.44% variance, under threshold.
    const report = reconcile({
      raw_extracted: rawInvoice({ total_amount: 4700 }),
    });
    expect(report.anomalies.filter((a) => a.code === AnomalyCodes.AMOUNT_VARIANCE)).toHaveLength(0);
    expect(report.reconciliation_status).toBe("MATCHED");
  });

  it("FAILED on duplicate invoice_number within the same session", () => {
    const num = "INV-DUP-001";
    const first = reconcile({ raw_extracted: rawInvoice({ invoice_number: num }) });
    expect(first.reconciliation_status).toBe("MATCHED");

    const second = reconcile({ raw_extracted: rawInvoice({ invoice_number: num }) });
    expect(second.anomalies.some((a) => a.code === AnomalyCodes.DUPLICATE_INVOICE)).toBe(true);
    expect(second.reconciliation_status).toBe("FAILED");
  });

  it("PARTIAL when only warning-level currency mismatch anomaly is present", () => {
    // PO-1001 is USD. We submit a valid invoice referencing PO-1001 but with EUR
    // currency at the same amount — only currency mismatch (warning) fires.
    const report = reconcile({
      raw_extracted: rawInvoice({ currency: "EUR" }),
    });
    expect(report.reconciliation_status).toBe("PARTIAL");
    expect(
      report.anomalies.every((a) => a.code === AnomalyCodes.CURRENCY_MISMATCH)
    ).toBe(true);
  });
});
