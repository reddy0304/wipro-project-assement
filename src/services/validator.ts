import {
  ExtractedInvoiceSchema,
  ISO_CURRENCIES,
  type ExtractedInvoice,
  type FieldValidation,
  type RawLlmInvoice,
} from "../schemas/invoice";

/**
 * FR-3: Field Validation.
 *
 * Returns:
 *   - `ok`: overall pass/fail
 *   - `fields`: per-field outcomes (good for UI display and debugging)
 *   - `clean`: the strictly-typed ExtractedInvoice if `ok` is true
 *
 * Validation rules (per the spec):
 *   - non-null critical fields (vendor_name, invoice_number, invoice_date,
 *     total_amount, currency, line_items[>=1])
 *   - invoice_date MUST be ISO YYYY-MM-DD AND a real calendar date
 *   - total_amount AND each line-item amount > 0
 *   - currency MUST be a valid 3-letter ISO-4217 code
 *
 * po_reference is intentionally NOT a hard validation failure here — a
 * missing PO is treated as an *anomaly* (FR-5(b)) instead, so the report
 * still surfaces it without short-circuiting the whole pipeline.
 */

export interface ValidationResult {
  ok: boolean;
  fields: FieldValidation[];
  clean: ExtractedInvoice | null;
}

function isRealIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

export function validateExtractedInvoice(
  raw: RawLlmInvoice
): ValidationResult {
  const fields: FieldValidation[] = [];
  const push = (field: string, ok: boolean, message?: string) =>
    fields.push({ field, ok, message });

  push(
    "vendor_name",
    !!raw.vendor_name && raw.vendor_name.trim().length > 0,
    "must be non-empty"
  );

  push(
    "invoice_number",
    !!raw.invoice_number && raw.invoice_number.trim().length > 0,
    "must be non-empty"
  );

  const dateOk = !!raw.invoice_date && isRealIsoDate(raw.invoice_date);
  push(
    "invoice_date",
    dateOk,
    "must be a real calendar date in YYYY-MM-DD format"
  );

  const totalOk =
    typeof raw.total_amount === "number" &&
    Number.isFinite(raw.total_amount) &&
    raw.total_amount > 0;
  push("total_amount", totalOk, "must be a finite number > 0");

  const currencyOk =
    typeof raw.currency === "string" &&
    (ISO_CURRENCIES as readonly string[]).includes(raw.currency.toUpperCase());
  push(
    "currency",
    currencyOk,
    "must be a valid 3-letter ISO-4217 code (e.g. USD, EUR, INR)"
  );

  const items = raw.line_items ?? [];
  const itemsOk =
    items.length > 0 &&
    items.every(
      (i) =>
        !!i.description &&
        i.description.trim().length > 0 &&
        typeof i.qty === "number" &&
        i.qty > 0 &&
        typeof i.unit_price === "number" &&
        i.unit_price > 0
    );
  push(
    "line_items",
    itemsOk,
    "at least one item required; every item needs description, qty>0, unit_price>0"
  );

  const allOk = fields.every((f) => f.ok);
  if (!allOk) return { ok: false, fields, clean: null };

  // We can now safely build a strict ExtractedInvoice. Final Zod parse
  // acts as a belt-and-braces type guarantee.
  const candidate = {
    vendor_name: raw.vendor_name!,
    invoice_number: raw.invoice_number!,
    invoice_date: raw.invoice_date!,
    total_amount: raw.total_amount!,
    currency: (raw.currency as string).toUpperCase(),
    po_reference: raw.po_reference ?? null,
    line_items: items.map((i) => ({
      description: i.description!,
      qty: i.qty!,
      unit_price: i.unit_price!,
    })),
  };

  const parsed = ExtractedInvoiceSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      fields: [
        ...fields,
        {
          field: "_schema",
          ok: false,
          message: parsed.error.issues.map((i) => i.message).join("; "),
        },
      ],
      clean: null,
    };
  }

  return { ok: true, fields, clean: parsed.data };
}
