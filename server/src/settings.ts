import crypto from "node:crypto";
import { getSetting, setSetting } from "./db";
import { encrypt } from "./crypto";
import { findClaude } from "./ai/claude-path";

export type AiProvider = "api" | "claude-code";

export interface AppSettings {
  ai: {
    /** "api" = Anthropic API key; "claude-code" = Claude subscription via the logged-in Claude Code CLI. */
    provider: AiProvider;
    model: string;
    apiKeyEnc: string | null;
    claudePath: string;
  };
  jira: {
    type: "cloud" | "server";
    baseUrl: string;
    email: string;
    tokenEnc: string | null;
  };
  runner: {
    headless: boolean;
    video: boolean;
    trace: boolean;
    maxSteps: number;
    /** Re-run a failed test once to confirm the failure before raising an issue. */
    confirmFailures: boolean;
    /** Accessibility + layout scan and a Claude visual review of every new screen. */
    frontendReview: boolean;
    /** Upper bound on Claude visual reviews per run (cost control). */
    maxVisualReviews: number;
  };
  /** Test inbox read over IMAP, so the agent can fetch OTP codes and verify emails. */
  mailbox: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    passEnc: string | null;
  };
  webhookToken: string;
}

const DEFAULTS: AppSettings = {
  ai: {
    provider: process.env.ANTHROPIC_API_KEY ? "api" : "claude-code",
    model: "claude-opus-5-5",
    apiKeyEnc: null,
    claudePath: "claude",
  },
  jira: { type: "cloud", baseUrl: "", email: "", tokenEnc: null },
  runner: { headless: true, video: true, trace: true, maxSteps: 60, confirmFailures: true, frontendReview: true, maxVisualReviews: 12 },
  mailbox: { host: "", port: 993, secure: true, user: "", passEnc: null },
  webhookToken: "",
};

export function getSettings(): AppSettings {
  const stored = getSetting<Partial<AppSettings>>("app", {});
  const s: AppSettings = {
    ai: { ...DEFAULTS.ai, ...stored.ai },
    jira: { ...DEFAULTS.jira, ...stored.jira },
    runner: { ...DEFAULTS.runner, ...stored.runner },
    mailbox: { ...DEFAULTS.mailbox, ...stored.mailbox },
    webhookToken: stored.webhookToken || "",
  };
  if (!s.webhookToken) {
    s.webhookToken = crypto.randomBytes(18).toString("base64url");
    setSetting("app", s);
  }
  return s;
}

/** Settings as shown to the UI: secrets are never sent back, only whether they are set. */
export function publicSettings() {
  const s = getSettings();
  return {
    ai: {
      provider: s.ai.provider,
      model: s.ai.model,
      claudePath: s.ai.claudePath,
      detectedClaudePath: findClaude(s.ai.claudePath),
      hasApiKey: !!s.ai.apiKeyEnc || !!process.env.ANTHROPIC_API_KEY,
    },
    jira: { type: s.jira.type, baseUrl: s.jira.baseUrl, email: s.jira.email, hasToken: !!s.jira.tokenEnc },
    runner: s.runner,
    mailbox: { host: s.mailbox.host, port: s.mailbox.port, secure: s.mailbox.secure, user: s.mailbox.user, hasPassword: !!s.mailbox.passEnc },
    webhookToken: s.webhookToken,
  };
}

export function saveSettings(input: any) {
  const s = getSettings();
  if (input.ai) {
    const { apiKey, ...rest } = input.ai;
    Object.assign(s.ai, pick(rest, ["provider", "model", "claudePath"]));
    if (typeof apiKey === "string" && apiKey.trim()) s.ai.apiKeyEnc = encrypt(apiKey.trim());
    if (apiKey === null) s.ai.apiKeyEnc = null;
  }
  if (input.jira) {
    const { token, ...rest } = input.jira;
    Object.assign(s.jira, pick(rest, ["type", "baseUrl", "email"]));
    s.jira.baseUrl = s.jira.baseUrl.replace(/\/+$/, "");
    if (typeof token === "string" && token.trim()) s.jira.tokenEnc = encrypt(token.trim());
    if (token === null) s.jira.tokenEnc = null;
  }
  if (input.runner) Object.assign(s.runner, pick(input.runner, ["headless", "video", "trace", "maxSteps", "confirmFailures", "frontendReview", "maxVisualReviews"]));
  if (input.mailbox) {
    const { password, ...rest } = input.mailbox;
    Object.assign(s.mailbox, pick(rest, ["host", "port", "secure", "user"]));
    if (typeof password === "string" && password.trim()) s.mailbox.passEnc = encrypt(password.trim());
    if (password === null) s.mailbox.passEnc = null;
  }
  if (input.regenerateWebhookToken) s.webhookToken = crypto.randomBytes(18).toString("base64url");
  setSetting("app", s);
  return publicSettings();
}

function pick(obj: any, keys: string[]) {
  const out: any = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}
