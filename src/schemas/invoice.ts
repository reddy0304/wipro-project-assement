import { z } from "zod";

/**
 * ISO 4217 currency codes used by FinFlow.
 * Kept as a finite list so Zod can enforce a closed set per FR-3.
 * Add more codes here as new currencies are onboarded.
 */
export const ISO_CURRENCIES = [
  "USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD", "CHF", "CNY",
  "SGD", "AED", "SAR", "HKD", "NZD", "ZAR", "BRL", "MXN", "SEK",
  "NOK", "DKK",
] as const;

export type IsoCurrency = (typeof ISO_CURRENCIES)[number];

/** Line item on an invoice — granular pricing. */
export const LineItemSchema = z.object({
  description: z.string().min(1),
  qty: z.number().positive(),
  unit_price: z.number().positive(),
});
export type LineItem = z.infer<typeof LineItemSchema>;

/**
 * Strict schema enforced AFTER the LLM extracts data (FR-3).
 * Critical fields are non-null, dates are ISO-8601, currency must be ISO-4217.
 */
export const ExtractedInvoiceSchema = z.object({
  vendor_name: z.string().min(1, "vendor_name is required"),
  invoice_number: z.string().min(1, "invoice_number is required"),
  invoice_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "invoice_date must be ISO YYYY-MM-DD"),
  line_items: z.array(LineItemSchema).min(1, "at least one line item required"),
  total_amount: z.number().positive("total_amount must be > 0"),
  currency: z.enum(ISO_CURRENCIES, {
    errorMap: () => ({ message: "currency must be a valid ISO-4217 code" }),
  }),
  po_reference: z.string().nullable(),
});
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

/**
 * Looser schema used to coerce raw LLM output before strict validation runs.
 * The LLM occasionally returns nulls or empty strings for fields it cannot
 * find — we accept them here so the validator (FR-3) can produce a clean
 * `validation_status` instead of crashing the request.
 */
export const RawLlmInvoiceSchema = z.object({
  vendor_name: z.string().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  invoice_date: z.string().nullable().optional(),
  line_items: z
    .array(
      z.object({
        description: z.string().nullable().optional(),
        qty: z.number().nullable().optional(),
        unit_price: z.number().nullable().optional(),
      })
    )
    .optional(),
  total_amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  po_reference: z.string().nullable().optional(),
});
export type RawLlmInvoice = z.infer<typeof RawLlmInvoiceSchema>;

/** Purchase Order stored in the mock dataset (FR-4). */
export const PurchaseOrderSchema = z.object({
  po_reference: z.string(),
  vendor_name: z.string(),
  po_value: z.number().positive(),
  currency: z.enum(ISO_CURRENCIES),
  issued_date: z.string(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

/** Anomaly types enumerated per FR-5. */
export const AnomalyCodes = {
  AMOUNT_VARIANCE: "AMOUNT_VARIANCE_GT_5_PCT",
  MISSING_PO: "MISSING_OR_UNMATCHED_PO_REFERENCE",
  DUPLICATE_INVOICE: "DUPLICATE_INVOICE_NUMBER",
  CURRENCY_MISMATCH: "CURRENCY_MISMATCH_VS_PO",
} as const;

export const AnomalySchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  context: z.record(z.any()).optional(),
});
export type Anomaly = z.infer<typeof AnomalySchema>;

/** Validation status for a single field. */
export const FieldValidationSchema = z.object({
  field: z.string(),
  ok: z.boolean(),
  message: z.string().optional(),
});
export type FieldValidation = z.infer<typeof FieldValidationSchema>;

/** Top-level outcome (FR-6). */
export const ReconciliationStatus = z.enum(["MATCHED", "PARTIAL", "FAILED"]);
export type ReconciliationStatusT = z.infer<typeof ReconciliationStatus>;

export const ReconciliationReportSchema = z.object({
  invoice_id: z.string(),
  extracted_data: z.unknown(),
  validation_status: z.object({
    ok: z.boolean(),
    fields: z.array(FieldValidationSchema),
  }),
  matched_po: PurchaseOrderSchema.nullable(),
  anomalies: z.array(AnomalySchema),
  reconciliation_status: ReconciliationStatus,
  created_at: z.string(),
});
export type ReconciliationReport = z.infer<typeof ReconciliationReportSchema>;
