import { Router, type Request, type Response } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { ingestFile } from "../services/ingestion";
import { extractInvoiceFields } from "../services/llmExtractor";
import { reconcile } from "../services/reconciler";
import { sessionStore } from "../storage/sessionStore";
import { RawLlmInvoiceSchema } from "../schemas/invoice";

/**
 * FR-1 + FR-7: POST /upload
 *
 * Two ingestion modes:
 *   1. multipart/form-data with field "file"  -> LLM extraction (FR-1+FR-2)
 *   2. application/json body                  -> raw structured invoice, skips LLM
 *
 * Returns the full reconciliation report immediately (one-shot ergonomics)
 * AND stores it so POST /reconcile/:id + GET /report/:id work afterward.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB hard cap
});

export const uploadRouter = Router();

uploadRouter.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      // Mode 2: raw JSON body — caller already has structured data.
      if (!req.file) {
        const parsed = RawLlmInvoiceSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: "Invalid JSON payload.",
            issues: parsed.error.issues,
            hint: "Send multipart/form-data with field 'file' OR JSON matching the invoice schema.",
          });
        }
        const invoice_id = uuidv4();
        const report = reconcile({ invoice_id, raw_extracted: parsed.data });
        sessionStore.save({
          invoice_id,
          raw_extracted: parsed.data,
          extracted: report.validation_status.ok
            ? (report.extracted_data as any)
            : null,
          report,
          created_at: report.created_at,
        });
        return res.status(200).json(report);
      }

      // Mode 1: file upload — ingest -> LLM extract -> reconcile.
      const ingested = await ingestFile(req.file);
      const raw = await extractInvoiceFields(ingested);

      const invoice_id = uuidv4();
      const report = reconcile({ invoice_id, raw_extracted: raw });
      sessionStore.save({
        invoice_id,
        raw_extracted: raw,
        extracted: report.validation_status.ok
          ? (report.extracted_data as any)
          : null,
        report,
        created_at: report.created_at,
      });

      return res.status(200).json(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      // eslint-disable-next-line no-console
      console.error("[upload] error:", err);
      return res.status(500).json({ error: message });
    }
  }
);
