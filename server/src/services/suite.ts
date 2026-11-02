import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import JSZip from "jszip";
import { z } from "zod";
import { aiJson } from "../ai/claude";
import { SPEC_FIX_SYSTEM, SPEC_SYSTEM } from "../ai/prompts";
import { SpecCode } from "../ai/schemas";
import { DATA_DIR, ROOT_DIR } from "../config";
import { all, get, insert, now, Row, update } from "../db";
import { emit } from "../runner/events";
import type { ExecutedStep, TestCaseSnapshot } from "../runner/agent";
import { samplePhotos } from "./samples";
import { requirementsBlock } from "./testcases";
import { resolveVariables } from "./variables";
import { getSettings } from "../settings";
import { decrypt } from "../crypto";

export const SUITES_DIR = path.join(DATA_DIR, "suites");
export const REPORTS_DIR = path.join(DATA_DIR, "suite-reports");
const require = createRequire(import.meta.url);

export class SuiteError extends Error {}

const SpecRepair = z.object({
  verdict: z.enum(["fixed", "app_defect"]).describe("app_defect: the failure is the application not meeting an expected-behaviour assertion"),
  code: z.string(),
  notes: z.string(),
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "suite";
const suiteDir = (projectId: string) => path.join(SUITES_DIR, projectId);

// ---------------------------------------------------------------- scaffold

const CONFIG = `import { defineConfig, devices } from "@playwright/test";

// Device name from Playwright's registry, e.g. "Desktop Chrome", "iPhone 15 Pro", "Pixel 7".
const device = process.env.QA_DEVICE || "Desktop Chrome";
const reportDir = process.env.QA_REPORT_DIR || "playwright-report";

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["html", { outputFolder: reportDir + "/html", open: "never" }],
    ["json", { outputFile: reportDir + "/results.json" }],
    ["list"],
  ],
  outputDir: process.env.QA_OUTPUT_DIR || "test-results",
  use: {
    baseURL: process.env.QA_BASE_URL,
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  // Mobile devices are emulated on Chromium (viewport, touch, user agent).
  projects: [{ name: device, use: { ...devices[device], browserName: "chromium", channel: undefined, defaultBrowserType: undefined } as never }],
});
`;

const HELPERS = `import fs from "node:fs";
import path from "node:path";
import type { Locator } from "@playwright/test";

/** Test data: every QA_VAR_<NAME> environment variable, e.g. QA_VAR_USERNAME -> vars.USERNAME. */
export const vars: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_t, key: string) => {
    const v = process.env["QA_VAR_" + key];
    if (v === undefined) throw new Error("Missing test data: set QA_VAR_" + key);
    return v;
  },
});

/** Paths to n sample item photos (1-6) shipped in support/photos. */
export function samplePhotos(n: number): string[] {
  const dir = process.env.QA_SAMPLES_DIR || path.join(__dirname, "photos");
  return Array.from({ length: Math.max(1, Math.min(6, n)) }, (_, i) => path.join(dir, "item-photo-" + (i + 1) + ".png")).filter((f) => fs.existsSync(f));
}

/** Draw a signature stroke inside a canvas / signature pad. */
export async function drawSignature(pad: Locator) {
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  if (!box) throw new Error("Signature pad is not visible");
  const page = pad.page();
  const x0 = box.x + box.width * 0.15, y0 = box.y + box.height * 0.6;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    await page.mouse.move(x0 + box.width * 0.7 * t, y0 - Math.sin(t * Math.PI * 3) * box.height * 0.25, { steps: 2 });
  }
  await page.mouse.up();
}

/**
 * Newest email received after \`since\` that mentions any word of \`hint\` (e.g. "code").
 * Needs QA_IMAP_HOST, QA_IMAP_PORT, QA_IMAP_USER, QA_IMAP_PASS (npm i -D imapflow mailparser).
 */
export async function readLatestEmail(since: Date, hint = "", timeoutMs = 90_000): Promise<{ subject: string; text: string }> {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const deadline = Date.now() + timeoutMs;
  const words = hint.toLowerCase().split(/\\s+/).filter(Boolean);
  for (;;) {
    const imap = new ImapFlow({
      host: process.env.QA_IMAP_HOST!, port: Number(process.env.QA_IMAP_PORT || 993), secure: process.env.QA_IMAP_SECURE !== "false",
      auth: { user: process.env.QA_IMAP_USER!, pass: process.env.QA_IMAP_PASS! }, logger: false,
    });
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");
    try {
      const uids = ((await imap.search({ since: new Date(since.getTime() - 86_400_000) }, { uid: true })) || []).slice(-25).reverse();
      for (const uid of uids) {
        const msg = await imap.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const mail = await simpleParser(msg.source);
        if ((mail.date?.getTime() ?? 0) < since.getTime() - 60_000) continue;
        const text = mail.text || "";
        const hay = ((mail.subject || "") + "\\n" + text).toLowerCase();
        if (!words.length || words.some((w) => hay.includes(w))) return { subject: mail.subject || "", text };
      }
    } finally {
      lock.release();
      await imap.logout().catch(() => {});
    }
    if (Date.now() > deadline) throw new Error("No email matching '" + hint + "' arrived in time");
    await new Promise((r) => setTimeout(r, 5000));
  }
}
`;

function ensureScaffold(projectId: string) {
  const dir = suiteDir(projectId);
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.mkdirSync(path.join(dir, "support"), { recursive: true });
  fs.writeFileSync(path.join(dir, "playwright.config.ts"), CONFIG);
  fs.writeFileSync(path.join(dir, "support", "helpers.ts"), HELPERS);
  return dir;
}

// ---------------------------------------------------------------- generation

function describeRecording(steps: ExecutedStep[]) {
  return steps
    .filter((s) => s.ok || s.action.type === "verify")
    .map((s) => {
      const a = s.action;
      const base = `#${s.n} ${a.type}${s.locator ? ` locator=${s.locator}` : a.ref != null ? " locator=(not unique - derive from description)" : ""}${a.value != null ? ` value=${JSON.stringify(a.value)}` : ""} — ${a.description} (url: ${s.url})`;
      if (!s.verification) return base;
      const v = s.verification;
      return `${base}\n    VERIFY ${v.check_id ?? ""}: expected "${v.expectation}" | observed "${v.observation}" | ${v.passed ? "PASSED" : "FAILED (app defect)"} | assertion ${v.assertion.kind}${v.locator ? ` on ${v.locator}` : ""}${v.assertion.text != null ? ` text=${JSON.stringify(v.assertion.text)}` : ""}`;
    })
    .join("\n");
}

function relFile(story: Row | undefined, code: string) {
  return `tests/${slug(story?.title ?? "general")}/${slug(code)}.spec.ts`;
}

/** Ask Claude to turn a recorded AI execution into a clean Playwright test, then prove it by running it. */
export async function generateSpec(resultId: string) {
  const result = get("results", resultId);
  if (!result) throw new SuiteError("Result not found");
  if (!result.test_case_id) throw new SuiteError("The test case for this result no longer exists.");
  const steps = result.steps as ExecutedStep[];
  if (!steps.length) throw new SuiteError("This result has no recorded steps to turn into code.");
  const run = get("runs", result.run_id)!;
  const tc = result.test_case as TestCaseSnapshot;
  const testCase = get("test_cases", result.test_case_id);
  const story = testCase?.story_id ? get("stories", testCase.story_id) : undefined;
  const dir = ensureScaffold(run.project_id);
  const file = relFile(story, tc.code);

  const prompt = [
    `TEST CASE ${tc.code}: ${tc.title}`,
    `Preconditions: ${tc.preconditions || "-"}\nSigned in at start: ${tc.requires_login ? "yes (sign in first using vars.USERNAME / vars.PASSWORD)" : "no"}`,
    `Expected result: ${tc.expected_result}`,
    tc.checks?.length ? `CHECKS:\n${tc.checks.map((c) => `${c.id}: ${c.text}`).join("\n")}` : "",
    story ? `REQUIREMENTS:\n${requirementsBlock(story, tc.requirement_ids)}` : "",
    `CHECK RESULTS FROM THE AI RUN:\n${((result.checks as Row[]) ?? []).map((c) => `${c.id} ${c.status}${c.reason ? ` (${c.reason})` : ""}`).join("\n") || "(none)"}`,
    `RECORDED EXECUTION (base URL ${get("projects", run.project_id)!.site_url}):\n${describeRecording(steps)}`,
    `File path: ${file} (helpers are at ../../support/helpers)`,
    "Write the Playwright test file.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const out = await aiJson({ system: SPEC_SYSTEM, prompt, schema: SpecCode, effort: "high", maxTokens: 32000 });

  const existing = all("SELECT * FROM specs WHERE test_case_id=?", result.test_case_id)[0];
  const spec = existing
    ? update("specs", existing.id, { file, code: out.code, result_id: resultId, status: "draft", last_error: null, updated_at: now() })!
    : insert("specs", { project_id: run.project_id, test_case_id: result.test_case_id, result_id: resultId, file, code: out.code, status: "draft", updated_at: now() });
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), out.code);
  return validateSpec(spec.id, prompt);
}

/** Run one spec; repair automation errors up to twice without weakening assertions. */
async function validateSpec(specId: string, context: string) {
  let spec = get("specs", specId)!;
  const defectRun = ((get("results", spec.result_id)?.checks as Row[]) ?? []).some((c) => c.status === "failed");
  for (let attempt = 0; attempt <= 2; attempt++) {
    const run = await runPlaywright(spec.project_id, [spec.file], `validate-${specId.slice(0, 8)}-${attempt}`);
    if (run.passed) return update("specs", specId, { status: "passing", last_error: null, updated_at: now() })!;
    const error = run.output.slice(-6000);
    if (attempt === 2) return update("specs", specId, { status: defectRun ? "failing" : "broken", last_error: error, updated_at: now() })!;
    const fix = await aiJson({
      system: SPEC_FIX_SYSTEM,
      prompt: `${context}\n\nCURRENT FILE:\n${spec.code}\n\nRUN OUTPUT:\n${error}\n\nThe AI run ${defectRun ? "DID find application defects (failed checks above), so assertions for those checks are expected to fail" : "found no application defects"}. Repair the file or report app_defect.`,
      schema: SpecRepair,
      effort: "high",
      maxTokens: 32000,
    });
    // "App defect" is only credible when the AI run itself saw a failing check; a defect-free run means the script is wrong.
    if (fix.verdict === "app_defect" && defectRun) return update("specs", specId, { status: "failing", last_error: error, updated_at: now() })!;
    spec = update("specs", specId, { code: fix.code, updated_at: now() })!;
    fs.writeFileSync(path.join(suiteDir(spec.project_id), spec.file), fix.code);
  }
  return spec;
}

export function saveSpecCode(specId: string, code: string) {
  const spec = get("specs", specId);
  if (!spec) throw new SuiteError("Spec not found");
  ensureScaffold(spec.project_id);
  fs.mkdirSync(path.dirname(path.join(suiteDir(spec.project_id), spec.file)), { recursive: true });
  fs.writeFileSync(path.join(suiteDir(spec.project_id), spec.file), code);
  return update("specs", specId, { code, status: "draft", updated_at: now() })!;
}

// ---------------------------------------------------------------- running

function playwrightEnv(project: Row, reportDir: string, outputDir: string, device: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, QA_BASE_URL: project.site_url, QA_DEVICE: device, QA_REPORT_DIR: reportDir, QA_OUTPUT_DIR: outputDir, FORCE_COLOR: "0" };
  samplePhotos(6);
  env.QA_SAMPLES_DIR = path.join(DATA_DIR, "samples");
  for (const [k, v] of Object.entries(resolveVariables(project))) env[`QA_VAR_${k}`] = v;
  const { mailbox } = getSettings();
  const pass = decrypt(mailbox.passEnc);
  if (mailbox.host && pass) Object.assign(env, { QA_IMAP_HOST: mailbox.host, QA_IMAP_PORT: String(mailbox.port), QA_IMAP_SECURE: String(mailbox.secure), QA_IMAP_USER: mailbox.user, QA_IMAP_PASS: pass });
  // Let specs resolve @playwright/test from QA Pilot's node_modules even if data lives elsewhere.
  env.NODE_PATH = [path.join(ROOT_DIR, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  return env;
}

interface PwRun {
  passed: boolean;
  output: string;
  reportDir: string;
  stats: { expected: number; unexpected: number; skipped: number; flaky: number; duration: number } | null;
  files: Record<string, "passed" | "failed" | "skipped">;
}

function runPlaywright(projectId: string, files: string[], label: string, device = "Desktop Chrome", onLine?: (line: string) => void): Promise<PwRun> {
  const project = get("projects", projectId)!;
  const dir = ensureScaffold(projectId);
  const reportDir = path.join(REPORTS_DIR, label);
  fs.rmSync(reportDir, { recursive: true, force: true });
  const cli = require.resolve("@playwright/test/cli");
  const args = [cli, "test", "--config", path.join(dir, "playwright.config.ts"), ...files.map((f) => f.replace(/\\/g, "/"))];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: dir, env: playwrightEnv(project, reportDir, path.join(reportDir, "artifacts"), device), windowsHide: true });
    let output = "";
    const onData = (d: Buffer) => {
      const text = d.toString();
      output += text;
      if (onLine) for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      let stats: PwRun["stats"] = null;
      const fileStatus: PwRun["files"] = {};
      try {
        const json = JSON.parse(fs.readFileSync(path.join(reportDir, "results.json"), "utf8"));
        stats = json.stats;
        const walk = (suite: any) => {
          for (const spec of suite.specs ?? []) {
            const ok = spec.tests.every((t: any) => t.status === "expected" || t.status === "flaky");
            const skipped = spec.tests.every((t: any) => t.status === "skipped");
            const rel = `tests/${String(spec.file).replace(/\\/g, "/").replace(/^tests\//, "")}`;
            fileStatus[rel] = skipped ? "skipped" : ok && fileStatus[rel] !== "failed" ? "passed" : "failed";
          }
          (suite.suites ?? []).forEach(walk);
        };
        (json.suites ?? []).forEach(walk);
      } catch {
        /* no JSON: compile error before tests ran */
      }
      resolve({ passed: code === 0, output, reportDir, stats, files: fileStatus });
    });
  });
}

/** Run the regression suite (all or selected specs) with Playwright's own HTML report. */
export function startSuiteRun(projectId: string, specIds: string[] | undefined, device: string) {
  const specs = specIds?.length ? all(`SELECT * FROM specs WHERE id IN (${specIds.map(() => "?").join(",")})`, ...specIds) : all("SELECT * FROM specs WHERE project_id=?", projectId);
  if (!specs.length) throw new SuiteError("No Playwright specs yet. Generate them from a test run first.");
  for (const s of specs) {
    const target = path.join(ensureScaffold(projectId), s.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, s.code);
  }
  const run = insert("suite_runs", { project_id: projectId, status: "running", device, spec_ids: specs.map((s) => s.id), created_at: now() });
  let log = "";
  void runPlaywright(projectId, specs.map((s) => s.file), run.id, device, (line) => {
    log += line + "\n";
    emit(`suite:${run.id}`, { type: "log", level: "info", message: line });
  }).then((res) => {
    for (const s of specs) {
      const st = res.files[s.file];
      if (st) update("specs", s.id, { status: st === "passed" ? "passing" : st === "failed" ? "failing" : s.status, updated_at: now() });
    }
    update("suite_runs", run.id, {
      status: res.stats ? (res.passed ? "passed" : "failed") : "error",
      summary: JSON.stringify({ stats: res.stats, files: res.files, hasReport: fs.existsSync(path.join(res.reportDir, "html", "index.html")) }),
      log: log.slice(-200_000) || res.output.slice(-200_000),
      finished_at: now(),
    });
    emit(`suite:${run.id}`, { type: "run", run: get("suite_runs", run.id)! });
  });
  return run;
}

// ---------------------------------------------------------------- download

export async function suiteZip(projectId: string) {
  const project = get("projects", projectId)!;
  const specs = all("SELECT * FROM specs WHERE project_id=? ORDER BY file", projectId);
  const zip = new JSZip();
  const root = zip.folder(slug(project.name) + "-playwright")!;
  root.file("playwright.config.ts", CONFIG);
  root.file("support/helpers.ts", HELPERS);
  for (const f of samplePhotos(6)) root.file(`support/photos/${path.basename(f)}`, fs.readFileSync(f));
  for (const s of specs) root.file(s.file, s.code);
  const varNames = Object.keys(resolveVariables(project));
  root.file(
    "package.json",
    JSON.stringify(
      { name: slug(project.name) + "-e2e", private: true, scripts: { test: "playwright test", report: "playwright show-report playwright-report/html" }, devDependencies: { "@playwright/test": "^1.64.1", imapflow: "^2.10.0", mailparser: "^3.14.1" } },
      null,
      2,
    ),
  );
  root.file(
    ".env.example",
    [`QA_BASE_URL=${project.site_url}`, "QA_DEVICE=Desktop Chrome", ...varNames.map((k) => `QA_VAR_${k}=`), "QA_IMAP_HOST=", "QA_IMAP_PORT=993", "QA_IMAP_USER=", "QA_IMAP_PASS="].join("\n") + "\n",
  );
  root.file(
    "README.md",
    `# ${project.name} — Playwright regression suite\n\nGenerated by QA Pilot from AI-executed test runs.\n\n\`\`\`bash\nnpm install\nnpx playwright install chromium\n# set the variables from .env.example in your shell or CI\nnpx playwright test\nnpx playwright show-report playwright-report/html\n\`\`\`\n\nRun on a device: \`QA_DEVICE="iPhone 15 Pro" npx playwright test\`.\n`,
  );
  return { buffer: await zip.generateAsync({ type: "nodebuffer" }), filename: `${slug(project.name)}-playwright.zip` };
}
