import { GoogleGenAI, Type } from "@google/genai";
import pRetry, { AbortError } from "p-retry";
import { config } from "../config";
import {
  RawLlmInvoiceSchema,
  type RawLlmInvoice,
} from "../schemas/invoice";
import type { IngestedPayload } from "./ingestion";

/**
 * FR-2: LLM Data Extraction.
 *
 * Uses Gemini's structured-output mode (`responseSchema`) so the model is
 * forced to emit JSON matching our shape — no fragile prose parsing.
 *
 * Bonus: wrapped in p-retry with exponential backoff (`LLM_MAX_RETRIES`).
 * If OPENAI_API_KEY is set, falls back to OpenAI after Gemini retries fail.
 */

const gemini = new GoogleGenAI({ apiKey: config.gemini.apiKey });

const EXTRACTION_PROMPT = `You are an accounts-payable assistant. Extract the following fields from the invoice content.

Rules:
- Return JSON only — no commentary.
- invoice_date MUST be ISO format YYYY-MM-DD. If the source uses a different format, normalize it.
- currency MUST be a 3-letter ISO-4217 code (USD, EUR, INR, etc.). Infer from currency symbols when needed.
- line_items: every row from the invoice's line-item table. qty and unit_price must be numbers.
- total_amount: the final grand total (after taxes/discounts). Must be a number.
- po_reference: the purchase order number referenced on the invoice. Use null if absent.
- If a field is genuinely not present, use null. Do NOT hallucinate values.`;

// Gemini structured-output schema (mirrors RawLlmInvoiceSchema in spirit).
const GEMINI_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    vendor_name: { type: Type.STRING, nullable: true },
    invoice_number: { type: Type.STRING, nullable: true },
    invoice_date: { type: Type.STRING, nullable: true },
    line_items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING, nullable: true },
          qty: { type: Type.NUMBER, nullable: true },
          unit_price: { type: Type.NUMBER, nullable: true },
        },
      },
    },
    total_amount: { type: Type.NUMBER, nullable: true },
    currency: { type: Type.STRING, nullable: true },
    po_reference: { type: Type.STRING, nullable: true },
  },
};

async function callGemini(payload: IngestedPayload): Promise<string> {
  const parts =
    payload.kind === "text"
      ? [{ text: EXTRACTION_PROMPT }, { text: payload.text }]
      : [
          { text: EXTRACTION_PROMPT },
          {
            inlineData: {
              mimeType: payload.mimeType,
              data: payload.data.toString("base64"),
            },
          },
        ];

  const result = await gemini.models.generateContent({
    model: config.gemini.model,
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      temperature: 0,
    },
  });

  const text = result.text;
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

async function callOpenAIFallback(payload: IngestedPayload): Promise<string> {
  // Lightweight, dependency-free fallback using fetch — only invoked if
  // OPENAI_API_KEY is set in env and Gemini failed all retries.
  // Image inputs are downgraded to text-only here for simplicity; if you
  // ship vision fallback, replace this with the chat.completions vision API.
  const userText =
    payload.kind === "text"
      ? payload.text
      : "[Image input provided — vision fallback not configured in this demo.]";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiFallback.apiKey}`,
    },
    body: JSON.stringify({
      model: config.openaiFallback.model,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: userText },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI fallback failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI fallback returned empty content.");
  return content;
}

function parseRaw(jsonText: string): RawLlmInvoice {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new AbortError(`LLM returned non-JSON text: ${(e as Error).message}`);
  }
  const result = RawLlmInvoiceSchema.safeParse(parsed);
  if (!result.success) {
    // Schema mismatch is non-retriable — the model produced shape we can't use.
    throw new AbortError(
      `LLM JSON did not match expected shape: ${result.error.message}`
    );
  }
  return result.data;
}

export async function extractInvoiceFields(
  payload: IngestedPayload
): Promise<RawLlmInvoice> {
  // Primary path: Gemini with retry/backoff.
  try {
    return await pRetry(
      async () => {
        const text = await callGemini(payload);
        return parseRaw(text);
      },
      {
        retries: config.retry.max,
        minTimeout: config.retry.baseMs,
        factor: 2,
        onFailedAttempt: (err) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[llm] Gemini attempt ${err.attemptNumber} failed: ${err.message}`
          );
        },
      }
    );
  } catch (geminiErr) {
    if (!config.openaiFallback.enabled) throw geminiErr;
    // eslint-disable-next-line no-console
    console.warn("[llm] Gemini exhausted retries — falling back to OpenAI.");
    const text = await callOpenAIFallback(payload);
    return parseRaw(text);
  }
}
