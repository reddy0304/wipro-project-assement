import { Router, type Request, type Response } from "express";
import { sessionStore } from "../storage/sessionStore";

/**
 * FR-7: GET /report/:invoiceId
 *
 * Returns the persisted reconciliation report for an invoice.
 */

export const reportRouter = Router();

reportRouter.get("/report/:invoiceId", (req: Request, res: Response) => {
  const { invoiceId } = req.params;
  const record = sessionStore.get(invoiceId);
  if (!record || !record.report) {
    return res.status(404).json({
      error: `No report found for invoice_id ${invoiceId}.`,
    });
  }
  return res.status(200).json(record.report);
});
