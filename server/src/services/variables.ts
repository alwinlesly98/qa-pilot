import { decrypt, encrypt } from "../crypto";
import type { Row } from "../db";

/** A project test-data variable; secrets are stored encrypted and never shown to Claude. */
interface StoredVariable {
  key: string;
  value?: string;
  valueEnc?: string | null;
  secret: boolean;
}

const KEY_RE = /^[A-Z][A-Z0-9_]{0,40}$/;

/** All variables with real values, including the built-in login credentials. */
export function resolveVariables(project: Row): Record<string, string> {
  const out: Record<string, string> = {};
  if (project.site_url) out.SITE_URL = project.site_url;
  if (project.login_url) out.LOGIN_URL = project.login_url;
  if (project.username) out.USERNAME = project.username;
  const pw = decrypt(project.password_enc);
  if (pw) out.PASSWORD = pw;
  for (const v of (project.variables ?? []) as StoredVariable[]) {
    const value = v.secret ? decrypt(v.valueEnc) : v.value;
    if (value != null) out[v.key] = value;
  }
  return out;
}

/** Names whose values must never be shown to the AI or written to logs. */
export function secretKeys(project: Row): Set<string> {
  const keys = new Set<string>(["PASSWORD"]);
  for (const v of (project.variables ?? []) as StoredVariable[]) if (v.secret) keys.add(v.key);
  return keys;
}

/** Lines for the agent prompt: non-secret values are shown so Claude can reason about them. */
export function describeVariables(project: Row): string {
  const all = resolveVariables(project);
  const secrets = secretKeys(project);
  const lines = Object.keys(all).map((k) => (secrets.has(k) ? `{{${k}}} = (secret)` : `{{${k}}} = ${all[k]}`));
  return lines.length ? lines.join("\n") : "(none configured)";
}

export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Variables for the UI: secret values masked. */
export function variablesView(project: Row) {
  return ((project.variables ?? []) as StoredVariable[]).map((v) => ({ key: v.key, secret: v.secret, value: v.secret ? "" : v.value ?? "", has_value: v.secret ? !!v.valueEnc : true }));
}

/** Merge edits from the UI; an empty secret value keeps the stored one. */
export function mergeVariables(project: Row | undefined, input: { key: string; value: string; secret: boolean }[]): StoredVariable[] {
  const previous = new Map(((project?.variables ?? []) as StoredVariable[]).map((v) => [v.key, v]));
  const out: StoredVariable[] = [];
  for (const raw of input) {
    const key = String(raw.key || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!KEY_RE.test(key) || ["USERNAME", "PASSWORD", "SITE_URL", "LOGIN_URL"].includes(key)) continue;
    if (raw.secret) {
      const valueEnc = raw.value ? encrypt(raw.value) : previous.get(key)?.valueEnc ?? null;
      out.push({ key, secret: true, valueEnc });
    } else {
      out.push({ key, secret: false, value: raw.value ?? "" });
    }
  }
  return out;
}
