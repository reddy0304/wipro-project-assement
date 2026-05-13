import fs from "node:fs";
import path from "node:path";
import { PurchaseOrderSchema, type PurchaseOrder } from "../schemas/invoice";

/**
 * FR-4: PO Matching.
 *
 * Loads the mock PO dataset once at module init (cheap, file is small) and
 * exposes `findByReference`. Missing/unmatched POs are NOT thrown as errors
 * — the reconciler converts that signal into anomaly MISSING_OR_UNMATCHED_PO.
 */

const PO_FILE = path.resolve(__dirname, "../../mock_data/purchase_orders.json");

let cache: Map<string, PurchaseOrder> | null = null;

function loadPOs(): Map<string, PurchaseOrder> {
  if (cache) return cache;
  const raw = fs.readFileSync(PO_FILE, "utf8");
  const parsed = JSON.parse(raw) as unknown[];
  const map = new Map<string, PurchaseOrder>();
  for (const entry of parsed) {
    const result = PurchaseOrderSchema.safeParse(entry);
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.warn(
        `[po-matcher] Skipping invalid PO record: ${result.error.message}`
      );
      continue;
    }
    map.set(result.data.po_reference.toUpperCase(), result.data);
  }
  cache = map;
  return cache;
}

export function findByReference(ref: string | null | undefined): PurchaseOrder | null {
  if (!ref) return null;
  return loadPOs().get(ref.toUpperCase()) ?? null;
}

/** Test helper — forces re-read from disk. */
export function _resetPoCache(): void {
  cache = null;
}
