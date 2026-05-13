import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required env var: ${name}. See .env.example for the template.`
    );
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

export const config = {
  port: Number(optional("PORT", "3000")),
  gemini: {
    apiKey: required("GEMINI_API_KEY"),
    model: optional("GEMINI_MODEL", "gemini-2.0-flash"),
  },
  openaiFallback: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: optional("OPENAI_MODEL", "gpt-4o-mini"),
    enabled: !!process.env.OPENAI_API_KEY,
  },
  retry: {
    max: Number(optional("LLM_MAX_RETRIES", "3")),
    baseMs: Number(optional("LLM_RETRY_BASE_MS", "500")),
  },
};
