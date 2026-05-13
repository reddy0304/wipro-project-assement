import type { ExtractedInvoice, ReconciliationReport } from "../schemas/invoice";

/**
 * In-memory store for the duration of a single server process / session.
 *
 * Trade-off: meets FR-7 (POST /upload → POST /reconcile → GET /report) without
 * a database dependency, which keeps the demo environment one-command. Swap
 * this for SQLite / Postgres by re-implementing this interface.
 */
export interface InvoiceRecord {
  invoice_id: string;
  raw_extracted: unknown;
  extracted: ExtractedInvoice | null;
  report: ReconciliationReport | null;
  created_at: string;
}

const invoices = new Map<string, InvoiceRecord>();

/**
 * Used by FR-5(c) — duplicate invoice_number detection within the session.
 * Tracks every invoice_number we've already seen this process lifetime.
 */
const seenInvoiceNumbers = new Set<string>();

export const sessionStore = {
  save(record: InvoiceRecord): void {
    invoices.set(record.invoice_id, record);
  },
  get(invoiceId: string): InvoiceRecord | undefined {
    return invoices.get(invoiceId);
  },
  update(invoiceId: string, patch: Partial<InvoiceRecord>): void {
    const existing = invoices.get(invoiceId);
    if (!existing) return;
    invoices.set(invoiceId, { ...existing, ...patch });
  },
  hasSeenInvoiceNumber(num: string): boolean {
    return seenInvoiceNumbers.has(num);
  },
  markInvoiceNumberSeen(num: string): void {
    seenInvoiceNumbers.add(num);
  },
  /** Test helper — wipe everything. */
  _reset(): void {
    invoices.clear();
    seenInvoiceNumbers.clear();
  },
};
