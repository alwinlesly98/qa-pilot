import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { z } from "zod";
import { getSettings } from "../settings";
import { decrypt } from "../crypto";
import { DATA_DIR } from "../config";
import { findClaude } from "./claude-path";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AiRequest<T> {
  system: string;
  prompt: string;
  /** Absolute paths to PNG/JPEG screenshots the model should look at. */
  images?: string[];
  schema: z.ZodType<T>;
  effort?: Effort;
  maxTokens?: number;
}

export class AiError extends Error {}

/**
 * Ask Claude for a JSON answer that matches `schema`.
 * Uses the Anthropic API when an API key is configured, otherwise the Claude Code CLI
 * (which runs on the user's Claude subscription after `claude login`).
 */
export async function aiJson<T>(req: AiRequest<T>): Promise<T> {
  const s = getSettings();
  return s.ai.provider === "api" ? viaApi(req, s.ai.model) : viaClaudeCode(req, s.ai.model, s.ai.claudePath);
}

// ---------------------------------------------------------------- Anthropic API

let cachedClient: { key: string; client: Anthropic } | null = null;

function apiClient(): Anthropic {
  const key = decrypt(getSettings().ai.apiKeyEnc) || process.env.ANTHROPIC_API_KEY || "";
  if (!key) throw new AiError("No Anthropic API key configured. Add one in Settings, or switch the provider to Claude Code (subscription).");
  if (cachedClient?.key !== key) cachedClient = { key, client: new Anthropic({ apiKey: key, maxRetries: 4 }) };
  return cachedClient.client;
}

function mediaType(file: string): "image/png" | "image/jpeg" {
  return file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

async function viaApi<T>(req: AiRequest<T>, model: string): Promise<T> {
  const client = apiClient();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(req.images ?? []).map(
      (file): Anthropic.Beta.BetaContentBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: mediaType(file), data: fs.readFileSync(file).toString("base64") },
      }),
    ),
    { type: "text", text: req.prompt },
  ];

  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: req.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: req.system,
      output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.schema) },
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") {
      throw new AiError(`Claude declined this request (${response.stop_details?.category ?? "unspecified"}).`);
    }
    if (response.stop_reason === "max_tokens") throw new AiError("Claude's answer was cut off (max_tokens). Try a shorter input.");
    if (response.parsed_output == null) throw new AiError("Claude returned output that did not match the expected format.");
    return response.parsed_output as T;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new AiError("Anthropic API key is invalid.");
    if (err instanceof Anthropic.RateLimitError) throw new AiError("Anthropic rate limit reached. Wait a moment and retry.");
    if (err instanceof Anthropic.APIError) throw new AiError(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
    throw err;
  }
}

// ---------------------------------------------------------------- Claude Code CLI (subscription)

function runClaude(configuredPath: string, args: string[], stdin: string, timeoutMs = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const claudePath = findClaude(configuredPath);
    if (!claudePath) {
      return reject(
        new AiError(
          "Claude Code was not found on this computer. Install it (npm i -g @anthropic-ai/claude-code, then run: claude login), set its full path in Settings → Claude, or switch to an Anthropic API key.",
        ),
      );
    }
    // .cmd/.bat shims only run through a shell on Windows: build one quoted command line for those.
    const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(claudePath);
    const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    const child = viaShell
      ? spawn([quote(claudePath), ...args.map(quote)].join(" "), { cwd: DATA_DIR, shell: true, windowsHide: true })
      : spawn(claudePath, args, { cwd: DATA_DIR, windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new AiError("Claude Code CLI timed out."));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new AiError(`Could not start Claude Code CLI ("${claudePath}"): ${e.message}. Install it with: npm i -g @anthropic-ai/claude-code, then run: claude login`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new AiError(`Claude Code CLI exited with code ${code}: ${err.slice(0, 500)}`));
      else resolve(out);
    });
    child.stdin.end(stdin);
  });
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object found");
  return JSON.parse(body.slice(start, end + 1));
}

async function viaClaudeCode<T>(req: AiRequest<T>, model: string, claudePath: string): Promise<T> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(req.schema));
  const imageNote = req.images?.length
    ? `\n\nScreenshots to inspect (open each with the Read tool before answering):\n${req.images.map((p) => `- ${p}`).join("\n")}`
    : "";
  const base =
    `${req.system}\n\n---\n\n${req.prompt}${imageNote}\n\n---\n\n` +
    `Respond with ONLY one JSON object (no prose, no code fence) that validates against this JSON Schema:\n${jsonSchema}`;

  const args = ["-p", "--output-format", "json", "--model", model, "--allowedTools", "Read", "--add-dir", DATA_DIR];
  let prompt = base;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runClaude(claudePath, args, prompt);
    let envelope: { result?: string; is_error?: boolean };
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new AiError(`Unexpected Claude Code output: ${raw.slice(0, 300)}`);
    }
    if (envelope.is_error) throw new AiError(`Claude Code error: ${envelope.result ?? "unknown"}. Make sure you have run "claude login".`);
    try {
      const parsed = req.schema.safeParse(extractJson(envelope.result ?? ""));
      if (parsed.success) return parsed.data;
      prompt = `${base}\n\nYour previous answer did not validate: ${parsed.error.message.slice(0, 800)}. Answer again with corrected JSON only.`;
    } catch (e) {
      prompt = `${base}\n\nYour previous answer was not valid JSON (${(e as Error).message}). Answer again with JSON only.`;
    }
  }
  throw new AiError("Claude Code did not return valid JSON after a retry.");
}

/** Cheap round-trip used by the Settings page "Test connection" button. */
export async function testAi(): Promise<string> {
  const r = await aiJson({
    system: "You are a connectivity check.",
    prompt: 'Reply with {"ok": true, "message": "<a short greeting>"}',
    schema: z.object({ ok: z.boolean(), message: z.string() }),
    effort: "low",
    maxTokens: 2000,
  });
  return r.message;
}
