import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { aiJson } from "../ai/claude";
import { AGENT_SYSTEM } from "../ai/prompts";
import { AgentDecision, type Check, type IssueDraft } from "../ai/schemas";
import { artifactUrl } from "../config";
import { waitForEmail } from "../services/mailbox";
import { samplePhotos } from "../services/samples";
import { substitute } from "../services/variables";
import type { FrontendAuditor } from "./frontend";
import { bestLocator } from "./locators";
import { capturePageState, clearHighlight, ElementInfo, formatElements, highlight } from "./page-state";

export interface TestCaseSnapshot {
  code: string;
  title: string;
  type: string;
  priority: string;
  preconditions: string;
  requires_login: boolean;
  steps: string[];
  test_data?: string;
  expected_result: string;
  checks?: Check[];
  requirement_ids?: string[];
}

export interface ExecutedStep {
  n: number;
  at: string;
  thought: string;
  testStep: number;
  action: AgentDecision["action"];
  target: ElementInfo | null;
  /** Unique Playwright locator for the target, recorded for code generation. */
  locator: string | null;
  ok: boolean;
  result: string;
  verification: (NonNullable<AgentDecision["verification"]> & { locator: string | null }) | null;
  url: string;
  screenshot: string | null;
}

export interface CheckResult {
  id: string;
  text: string;
  status: "passed" | "failed" | "not_run";
  observation: string | null;
  reason: string | null;
}

export interface DefectReport extends Omit<IssueDraft, "element_ref"> {
  screenshotPath: string | null;
  pageUrl: string;
  consoleErrors: string[];
}

export interface TestOutcome {
  status: "passed" | "failed" | "blocked" | "error" | "cancelled" | "flaky";
  summary: string;
  steps: ExecutedStep[];
  checks: CheckResult[];
  defects: DefectReport[];
  videoPath: string | null;
}

export interface AgentOptions {
  context: BrowserContext;
  testCase: TestCaseSnapshot;
  baseUrl: string;
  startUrl?: string;
  loggedIn: boolean;
  vars: Record<string, string>;
  secretKeys: Set<string>;
  variablesText: string;
  requirementsText: string;
  appContext: string | null;
  dir: string;
  maxSteps: number;
  auditor?: FrontendAuditor;
  onStep: (step: ExecutedStep) => void;
  onThinking: (text: string) => void;
  onFrame: (jpegBase64: string) => void;
  isCancelled: () => boolean;
}

const MAX_CONSECUTIVE_ERRORS = 5;
const MAX_FINISH_REMINDERS = 2;

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
}

function resolveUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

async function startScreencast(context: BrowserContext, page: Page, onFrame: (d: string) => void) {
  try {
    const cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number }) => {
      onFrame(f.data);
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: 1280, maxHeight: 900, everyNthFrame: 2 });
    return cdp;
  } catch {
    return null; // non-Chromium or closed page: live view is best-effort
  }
}

function describeTestCase(tc: TestCaseSnapshot) {
  return [
    `TEST CASE ${tc.code}: ${tc.title}  (type: ${tc.type}, priority: ${tc.priority})`,
    tc.preconditions ? `Preconditions: ${tc.preconditions}` : "",
    `Steps:\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    tc.test_data ? `Test input: ${tc.test_data}` : "",
    `Expected result: ${tc.expected_result}`,
    tc.checks?.length ? `CHECKS TO VERIFY (each needs a verify action with its check_id):\n${tc.checks.map((c) => `${c.id}: ${c.text}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatHistory(steps: ExecutedStep[]) {
  if (!steps.length) return "(nothing yet - this is the first action)";
  return steps
    .slice(-30)
    .map((s) => {
      const v = s.verification ? ` | ${s.verification.check_id ?? "verify"} "${s.verification.expectation}": ${s.verification.passed ? "PASSED" : "FAILED"} (${s.verification.observation})` : "";
      return `#${s.n} [test step ${s.testStep}] ${s.action.description} -> ${s.ok ? "OK" : "ERROR"}: ${s.result.slice(0, 1500)}${v}`;
    })
    .join("\n");
}

/** Never let secret values reach logs or stored steps. */
function redact(text: string, vars: Record<string, string>, secrets: Set<string>) {
  let out = text;
  for (const k of secrets) if (vars[k] && vars[k].length > 2) out = out.split(vars[k]).join(`{{${k}}}`);
  return out;
}

export async function runTestCase(opts: AgentOptions): Promise<TestOutcome> {
  const { context, testCase, baseUrl } = opts;
  fs.mkdirSync(opts.dir, { recursive: true });
  const startedAt = new Date();

  let page = await context.newPage();
  const videoPath = (await page.video()?.path().catch(() => null)) ?? null;
  const allErrors: string[] = [];
  let recentErrors: string[] = [];
  const trackErrors = (p: Page) => {
    const push = (msg: string) => {
      allErrors.push(msg);
      recentErrors.push(msg);
    };
    p.on("console", (m) => m.type() === "error" && push(`console: ${m.text().slice(0, 300)}`));
    p.on("pageerror", (e) => push(`page error: ${e.message.slice(0, 300)}`));
    p.on("response", (r) => r.status() >= 500 && push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 200)}`));
    p.on("requestfailed", (r) => !/favicon|analytics|gtag|hotjar/i.test(r.url()) && push(`request failed: ${r.method()} ${r.url().slice(0, 200)} (${r.failure()?.errorText ?? ""})`));
  };
  trackErrors(page);
  let screencast = await startScreencast(context, page, opts.onFrame);

  // Follow new tabs/popups opened by the app.
  context.on("page", async (p) => {
    page = p;
    trackErrors(p);
    await screencast?.detach().catch(() => {});
    screencast = await startScreencast(context, p, opts.onFrame);
  });

  const steps: ExecutedStep[] = [];
  const checks = testCase.checks ?? [];
  const checkResults = (notVerified: { check_id: string; reason: string }[] = []): CheckResult[] =>
    checks.map((c) => {
      const last = [...steps].reverse().find((s) => s.verification?.check_id === c.id);
      if (last?.verification) return { id: c.id, text: c.text, status: last.verification.passed ? "passed" : "failed", observation: last.verification.observation, reason: null };
      const nv = notVerified.find((x) => x.check_id === c.id);
      return { id: c.id, text: c.text, status: "not_run", observation: null, reason: nv?.reason ?? "Not verified during the run" };
    });

  const finish = async (o: Omit<TestOutcome, "steps" | "videoPath" | "checks"> & { checks?: CheckResult[] }): Promise<TestOutcome> => {
    await screencast?.detach().catch(() => {});
    return { checks: checkResults(), ...o, steps, videoPath };
  };

  try {
    await page.goto(resolveUrl(opts.startUrl || baseUrl, baseUrl), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
  } catch (e) {
    return finish({ status: "blocked", summary: `Could not open ${opts.startUrl || baseUrl}: ${(e as Error).message.split("\n")[0]}`, defects: [] });
  }

  let consecutiveErrors = 0;
  let reminders = 0;
  const header = [
    describeTestCase(testCase),
    opts.requirementsText ? `RELEVANT REQUIREMENTS FROM THE STORY:\n${opts.requirementsText}` : "",
    `Site base URL: ${baseUrl}`,
    `TEST DATA VARIABLES (use as {{NAME}}):\n${opts.variablesText}`,
    opts.loggedIn ? "Session: the browser starts already signed in." : "Session: the browser starts signed out (guest).",
    opts.appContext ? `Application context:\n${opts.appContext.slice(0, 5000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  for (let n = 1; n <= opts.maxSteps; n++) {
    if (opts.isCancelled()) return finish({ status: "cancelled", summary: "Run was cancelled.", defects: [] });

    const state = await capturePageState(page);
    await opts.auditor?.audit(page, state).catch(() => {});
    const shotPath = path.join(opts.dir, `step-${String(n).padStart(2, "0")}.jpg`);
    await page.screenshot({ path: shotPath, type: "jpeg", quality: 70 }).catch(() => {});
    const haveShot = fs.existsSync(shotPath);

    const prompt = [
      header,
      `HISTORY OF YOUR ACTIONS:\n${formatHistory(steps)}`,
      `CURRENT PAGE: ${state.url}\nTitle: ${state.title}`,
      `NEW CONSOLE / NETWORK ERRORS SINCE LAST ACTION:\n${recentErrors.length ? recentErrors.slice(-8).join("\n") : "(none)"}`,
      `INTERACTIVE ELEMENTS:\n${formatElements(state.elements)}`,
      `VISIBLE PAGE TEXT (truncated):\n${state.text}`,
      `Step ${n} of at most ${opts.maxSteps}. Choose the next action.`,
    ].join("\n\n");
    recentErrors = [];

    let decision: AgentDecision;
    try {
      decision = await aiJson({ system: AGENT_SYSTEM, prompt, images: haveShot ? [shotPath] : [], schema: AgentDecision, effort: "medium" });
    } catch (e) {
      return finish({ status: "error", summary: `AI error: ${(e as Error).message}`, defects: [] });
    }
    opts.onThinking(decision.thought);

    const { action } = decision;
    const target = action.ref != null ? state.elements.find((e) => e.ref === action.ref) ?? null : null;
    const verifyTarget = decision.verification?.assertion.ref != null ? state.elements.find((e) => e.ref === decision.verification!.assertion.ref) ?? null : null;
    const step: ExecutedStep = {
      n,
      at: new Date().toISOString(),
      thought: decision.thought,
      testStep: decision.current_step,
      action: { ...action, value: action.value != null ? redact(action.value, opts.vars, opts.secretKeys) : null },
      target,
      locator: await bestLocator(page, target),
      ok: true,
      result: "",
      verification: decision.verification ? { ...decision.verification, locator: await bestLocator(page, verifyTarget) } : null,
      url: state.url,
      screenshot: haveShot ? artifactUrl(shotPath) : null,
    };

    if (action.type === "finish") {
      const fin = decision.finish ?? { status: "blocked" as const, summary: "Agent finished without a verdict.", issues: [], not_verified: [] };
      const results = checkResults(fin.not_verified);
      const unverified = results.filter((c) => c.status === "not_run" && !fin.not_verified.some((x) => x.check_id === c.id));
      const failedChecks = results.filter((c) => c.status === "failed");

      // Guard rails: no "passed" without evidence for every check.
      if (fin.status === "passed" && reminders < MAX_FINISH_REMINDERS && (!steps.some((s) => s.action.type === "verify") || unverified.length || failedChecks.length)) {
        reminders++;
        step.ok = false;
        step.result = failedChecks.length
          ? `Rejected: ${failedChecks.map((c) => c.id).join(", ")} failed verification - finish as failed with an issue per defect, or re-verify if it was a timing problem.`
          : unverified.length
            ? `Rejected: verify ${unverified.map((c) => c.id).join(", ")} first, or list them in not_verified with a reason.`
            : "Rejected: verify the expected result with a verify action before finishing as passed.";
        steps.push(step);
        opts.onStep(step);
        continue;
      }

      let status = fin.status;
      let issues = fin.issues;
      if (failedChecks.length && status === "passed") status = "failed";
      if (status === "failed" && !issues.length) {
        issues = (failedChecks.length ? failedChecks : [{ id: null, text: testCase.expected_result, observation: fin.summary }]).map((c) => ({
          check_id: c.id,
          category: "functional" as const,
          title: `${testCase.code}: ${c.text}`.slice(0, 200),
          actual: c.observation ?? fin.summary,
          expected: c.text,
          severity: "major" as const,
          steps_to_reproduce: testCase.steps,
          comment: fin.summary,
          element_ref: null,
        }));
      }
      step.result = `${status.toUpperCase()}: ${fin.summary}`;
      steps.push(step);
      opts.onStep(step);

      const defects: DefectReport[] = [];
      if (status === "failed") {
        for (const [i, issue] of issues.entries()) {
          const file = path.join(opts.dir, `defect-${i + 1}.png`);
          const marked = await highlight(page, issue.element_ref);
          await page.screenshot({ path: file, type: "png" }).catch(() => {});
          if (marked) await clearHighlight(page);
          const { element_ref: _ref, ...rest } = issue;
          defects.push({ ...rest, screenshotPath: fs.existsSync(file) ? file : haveShot ? shotPath : null, pageUrl: page.url(), consoleErrors: allErrors.slice(-15) });
        }
      }
      return finish({ status, summary: fin.summary, defects, checks: results });
    }

    try {
      step.result = redact(await execute(page, action, opts, startedAt), opts.vars, opts.secretKeys);
      consecutiveErrors = 0;
    } catch (e) {
      step.ok = false;
      step.result = redact((e as Error).message.split("\n")[0].slice(0, 300), opts.vars, opts.secretKeys);
      consecutiveErrors++;
    }
    steps.push(step);
    opts.onStep(step);

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      return finish({ status: "blocked", summary: `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive action errors. Last: ${step.result}`, defects: [] });
    }
  }
  return finish({ status: "blocked", summary: `Step limit (${opts.maxSteps}) reached before the test case finished.`, defects: [] });
}

async function drawSignature(page: Page, ref: number) {
  const loc = page.locator(`[data-qa-ref="${ref}"]`).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error("Signature area is not visible");
  const x0 = box.x + box.width * 0.15;
  const y0 = box.y + box.height * 0.6;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    await page.mouse.move(x0 + box.width * 0.7 * t, y0 - Math.sin(t * Math.PI * 3) * box.height * 0.25, { steps: 2 });
  }
  await page.mouse.up();
}

async function upload(page: Page, ref: number, count: number) {
  const files = samplePhotos(count);
  const loc = page.locator(`[data-qa-ref="${ref}"]`).first();
  const isFileInput = await loc.evaluate((el) => el instanceof HTMLInputElement && el.type === "file").catch(() => false);
  if (isFileInput) {
    try {
      await loc.setInputFiles(files);
    } catch {
      for (const f of files) await loc.setInputFiles(f); // single-file input: add one at a time
    }
    return `Attached ${files.length} photo(s)`;
  }
  let attached = 0;
  for (const batch of [files]) {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 8000 }), loc.click({ timeout: 8000 })]);
    if (chooser.isMultiple()) {
      await chooser.setFiles(batch);
      attached = batch.length;
    } else {
      await chooser.setFiles(batch[0]);
      attached = 1;
      for (const f of batch.slice(1)) {
        const [next] = await Promise.all([page.waitForEvent("filechooser", { timeout: 8000 }), loc.click({ timeout: 8000 })]);
        await next.setFiles(f);
        attached++;
      }
    }
  }
  return `Attached ${attached} photo(s) via the file chooser`;
}

async function execute(page: Page, action: AgentDecision["action"], opts: AgentOptions, startedAt: Date): Promise<string> {
  const loc = () => {
    if (action.ref == null) throw new Error(`${action.type} needs an element ref`);
    return page.locator(`[data-qa-ref="${action.ref}"]`).first();
  };
  const raw = action.value ?? "";
  const value = substitute(raw, opts.vars);
  const unknown = value.match(/\{\{([A-Z][A-Z0-9_]*)\}\}/);
  if (unknown && ["fill", "navigate", "select", "press"].includes(action.type)) {
    throw new Error(`Variable {{${unknown[1]}}} is not defined. Add it under Project → Settings → Test data, or finish as blocked.`);
  }
  const timeout = 8_000;

  switch (action.type) {
    case "navigate":
      await page.goto(resolveUrl(value, opts.baseUrl), { waitUntil: "domcontentloaded", timeout: 45_000 });
      break;
    case "back":
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 });
      break;
    case "click":
      await loc().click({ timeout });
      break;
    case "fill":
      await loc().fill(value, { timeout });
      break;
    case "select": {
      const l = loc();
      await l.selectOption({ label: value }, { timeout }).catch(() => l.selectOption(value, { timeout }));
      break;
    }
    case "press":
      if (action.ref != null) await loc().press(value || "Enter", { timeout });
      else await page.keyboard.press(value || "Enter");
      break;
    case "hover":
      await loc().hover({ timeout });
      break;
    case "check":
      await loc().check({ timeout, force: true });
      break;
    case "uncheck":
      await loc().uncheck({ timeout, force: true });
      break;
    case "scroll":
      if (action.ref != null) await loc().scrollIntoViewIfNeeded({ timeout });
      else await page.mouse.wheel(0, raw === "up" ? -700 : 700);
      break;
    case "wait":
      await page.waitForTimeout(Math.min(Number(raw) || 1500, 10_000));
      break;
    case "upload":
      if (action.ref == null) throw new Error("upload needs the file input or photo button ref");
      return upload(page, action.ref, Number(raw) || 1);
    case "draw":
      if (action.ref == null) throw new Error("draw needs the signature area ref");
      await drawSignature(page, action.ref);
      return "Signature drawn";
    case "read_email": {
      const mail = await waitForEmail(startedAt, raw);
      return `Email received ${mail.date}\nFrom: ${mail.from}\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text.slice(0, 3000)}`;
    }
    case "verify":
      return "Verification recorded";
  }
  await settle(page);
  return action.type === "navigate" || action.type === "back" ? `Now on ${page.url()}` : "Done";
}
