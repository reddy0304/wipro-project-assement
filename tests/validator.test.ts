import { describe, expect, it } from "vitest";
import { validateExtractedInvoice } from "../src/services/validator";
import type { RawLlmInvoice } from "../src/schemas/invoice";

/** Helper to build a known-good raw invoice that we can mutate per test. */
function goodRaw(overrides: Partial<RawLlmInvoice> = {}): RawLlmInvoice {
  return {
    vendor_name: "Acme Industrial Supplies",
    invoice_number: "INV-2026-0429",
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

describe("FR-3: validateExtractedInvoice", () => {
  it("passes a fully valid invoice", () => {
    const result = validateExtractedInvoice(goodRaw());
    expect(result.ok).toBe(true);
    expect(result.clean).not.toBeNull();
    expect(result.fields.every((f) => f.ok)).toBe(true);
  });

  it("fails when vendor_name is missing", () => {
    const result = validateExtractedInvoice(goodRaw({ vendor_name: null }));
    expect(result.ok).toBe(false);
    expect(result.fields.find((f) => f.field === "vendor_name")?.ok).toBe(false);
  });

  it("fails when invoice_date is not ISO YYYY-MM-DD", () => {
    const result = validateExtractedInvoice(goodRaw({ invoice_date: "29/04/2026" }));
    expect(result.ok).toBe(false);
    expect(result.fields.find((f) => f.field === "invoice_date")?.ok).toBe(false);
  });

  it("fails when invoice_date is a fake calendar date", () => {
    const result = validateExtractedInvoice(goodRaw({ invoice_date: "2026-02-31" }));
    expect(result.ok).toBe(false);
    expect(result.fields.find((f) => f.field === "invoice_date")?.ok).toBe(false);
  });

  it("fails when total_amount is zero or negative", () => {
    expect(validateExtractedInvoice(goodRaw({ total_amount: 0 })).ok).toBe(false);
    expect(validateExtractedInvoice(goodRaw({ total_amount: -10 })).ok).toBe(false);
  });

  it("fails when currency is not ISO-4217", () => {
    const result = validateExtractedInvoice(goodRaw({ currency: "DOLLARS" }));
    expect(result.ok).toBe(false);
    expect(result.fields.find((f) => f.field === "currency")?.ok).toBe(false);
  });

  it("accepts lowercase currency by normalizing to uppercase", () => {
    const result = validateExtractedInvoice(goodRaw({ currency: "usd" }));
    expect(result.ok).toBe(true);
    expect(result.clean?.currency).toBe("USD");
  });

  it("fails when line_items is empty", () => {
    const result = validateExtractedInvoice(goodRaw({ line_items: [] }));
    expect(result.ok).toBe(false);
    expect(result.fields.find((f) => f.field === "line_items")?.ok).toBe(false);
  });

  it("fails when a line item has qty <= 0", () => {
    const result = validateExtractedInvoice(
      goodRaw({
        line_items: [{ description: "Bad item", qty: 0, unit_price: 5 }],
      })
    );
    expect(result.ok).toBe(false);
  });

  it("passes even when po_reference is null (treated as anomaly, not validation error)", () => {
    const result = validateExtractedInvoice(goodRaw({ po_reference: null }));
    expect(result.ok).toBe(true);
  });
});
