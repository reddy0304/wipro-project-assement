import pdfParse from "pdf-parse";

/**
 * FR-1: Invoice Ingestion.
 *
 * Normalizes any supported input into one of two shapes:
 *   - `text`   : extracted plain text for the LLM to read
 *   - `image`  : raw bytes + mime, sent multimodally to Gemini
 *
 * Supported sources:
 *   - PDF upload                 -> extracted via pdf-parse
 *   - Image upload (png/jpg/...) -> passed through to LLM as inlineData
 *   - Plain text upload (.txt)   -> read as UTF-8
 *   - Raw JSON body              -> handled directly by the route (no LLM)
 */

export type IngestedPayload =
  | { kind: "text"; text: string }
  | { kind: "image"; mimeType: string; data: Buffer };

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export async function ingestFile(
  file: Express.Multer.File
): Promise<IngestedPayload> {
  const mime = (file.mimetype || "").toLowerCase();

  if (mime === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
    const parsed = await pdfParse(file.buffer);
    const text = (parsed.text || "").trim();
    if (!text) {
      throw new Error(
        "PDF parsed to empty text — may be a scanned image PDF. Re-upload as an image."
      );
    }
    return { kind: "text", text };
  }

  if (IMAGE_MIMES.has(mime)) {
    return { kind: "image", mimeType: mime, data: file.buffer };
  }

  if (
    mime.startsWith("text/") ||
    mime === "application/octet-stream" ||
    file.originalname.toLowerCase().endsWith(".txt")
  ) {
    return { kind: "text", text: file.buffer.toString("utf8") };
  }

  throw new Error(
    `Unsupported file type: ${mime || "unknown"}. Accepted: PDF, image, plain text.`
  );
}
