import { Router, type Request, type Response } from "express";
import { sessionStore } from "../storage/sessionStore";
import { reconcile } from "../services/reconciler";
import { RawLlmInvoiceSchema } from "../schemas/invoice";

/**
 * FR-7: POST /reconcile/:invoiceId
 *
 * Re-runs the reconciliation pipeline (validation + PO match + anomalies)
 * against the previously-extracted data for a given invoice_id. Useful when:
 *   - The mock PO dataset is updated and you want to re-check old invoices
 *   - A user manually corrected the raw_extracted JSON via request body
 */

export const reconcileRouter = Router();

reconcileRouter.post(
  "/reconcile/:invoiceId",
  async (req: Request, res: Response) => {
    const { invoiceId } = req.params;
    const record = sessionStore.get(invoiceId);
    if (!record) {
      return res.status(404).json({
        error: `No invoice found with id ${invoiceId}. Upload it first via POST /upload.`,
      });
    }

    // Allow caller to override the raw extracted data (manual correction flow).
    let raw = record.raw_extracted;
    if (req.body && Object.keys(req.body).length > 0) {
      const parsed = RawLlmInvoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid override payload.",
          issues: parsed.error.issues,
        });
      }
      raw = parsed.data;
    }

    const report = reconcile({
      invoice_id: invoiceId,
      raw_extracted: raw as any,
    });
    sessionStore.update(invoiceId, {
      raw_extracted: raw,
      extracted: report.validation_status.ok ? (report.extracted_data as any) : null,
      report,
    });

    return res.status(200).json(report);
  }
);
