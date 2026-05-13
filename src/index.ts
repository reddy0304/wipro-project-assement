import express from "express";
import path from "node:path";
import { config } from "./config";
import { uploadRouter } from "./routes/upload";
import { reconcileRouter } from "./routes/reconcile";
import { reportRouter } from "./routes/report";

/**
 * FR-7: REST API entrypoint.
 *
 * Mounts:
 *   POST /upload                     - Submit invoice for processing (FR-1, FR-2)
 *   POST /reconcile/:invoiceId       - Re-trigger reconciliation        (FR-3..FR-6)
 *   GET  /report/:invoiceId          - Retrieve report                  (FR-6)
 *   GET  /health                     - Liveness probe (for Docker)
 *   GET  /                           - Static demo UI (bonus)
 */

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use(uploadRouter);
app.use(reconcileRouter);
app.use(reportRouter);

// Static demo UI for FR bonus — single page.
app.use(express.static(path.resolve(__dirname, "../public")));

// 404 fallback for unmounted API routes.
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] Invoice Reconciliation Agent listening on :${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`[server] Demo UI: http://localhost:${config.port}/`);
});

export { app };
