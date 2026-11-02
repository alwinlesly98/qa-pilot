import fs from "node:fs";
import path from "node:path";
import { chromium, devices, type Browser, type BrowserContext, type BrowserContextOptions } from "playwright";
import { aiJson } from "../ai/claude";
import { SUMMARY_SYSTEM } from "../ai/prompts";
import { RunSummary } from "../ai/schemas";
import { ARTIFACTS_DIR } from "../config";
import { all, get, insert, now, Row, update } from "../db";
import { getSettings } from "../settings";
import { requirementsBlock, storyBlock } from "../services/testcases";
import { describeVariables, resolveVariables, secretKeys } from "../services/variables";
import { runTestCase, type TestCaseSnapshot, type TestOutcome } from "./agent";
import { emit } from "./events";
import { FrontendAuditor, type FrontendFinding } from "./frontend";

export const DEVICES = ["Desktop Chrome", "Desktop Edge", "iPhone 15 Pro", "iPhone SE", "Pixel 7", "Galaxy S9+", "iPad Pro 11", "iPad Mini"];

const queue: string[] = [];
const cancelled = new Set<string>();
let busy = false;

export function enqueueRun(runId: string) {
  queue.push(runId);
  void pump();
}

export function cancelRun(runId: string) {
  cancelled.add(runId);
  const i = queue.indexOf(runId);
  if (i >= 0) {
    queue.splice(i, 1);
    finishRun(runId, "cancelled");
  }
}

/** Runs left as running/queued after a crash or restart. */
export function recoverRuns() {
  for (const r of all("SELECT id FROM runs WHERE status IN ('running','queued')")) {
    update("runs", r.id, { status: "error", error: "Server restarted during the run.", finished_at: now() });
  }
  for (const r of all("SELECT id FROM suite_runs WHERE status='running'")) update("suite_runs", r.id, { status: "error", finished_at: now() });
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await executeRun(id);
      } catch (e) {
        update("runs", id, { status: "error", error: (e as Error).message, finished_at: now() });
        emit(id, { type: "run", run: get("runs", id)! });
      }
    }
  } finally {
    busy = false;
  }
}

function finishRun(runId: string, status: string) {
  update("runs", runId, { status, finished_at: now() });
  for (const r of all("SELECT id FROM results WHERE run_id=? AND status IN ('pending','running')", runId)) {
    update("results", r.id, { status: "cancelled" });
  }
  emit(runId, { type: "run", run: get("runs", runId)! });
}

const LOGIN_CASE = (project: Row): TestCaseSnapshot => ({
  code: "LOGIN",
  title: "Sign in with the project credentials",
  type: "Setup",
  priority: "high",
  preconditions: "",
  requires_login: false,
  steps: [
    `Open ${project.login_url || project.site_url}`,
    "Sign in using username {{USERNAME}} and password {{PASSWORD}}",
    ...(project.login_notes ? [project.login_notes] : []),
  ],
  expected_result: "The user is signed in (an authenticated page, account menu or sign-out option is visible).",
});

interface RunCtx {
  runId: string;
  project: Row;
  baseUrl: string;
  vars: Record<string, string>;
  secrets: Set<string>;
  variablesText: string;
  stories: Map<string, Row>;
  auditor: FrontendAuditor;
  currentResultId: string | null;
}

async function executeRun(runId: string) {
  const run = get("runs", runId)!;
  const project = get("projects", run.project_id)!;
  const build = run.build_id ? get("builds", run.build_id) : undefined;
  const settings = getSettings();
  const baseUrl = build?.site_url || project.site_url;
  const runDir = path.join(ARTIFACTS_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  update("runs", runId, { status: "running", started_at: now() });
  emit(runId, { type: "run", run: get("runs", runId)! });

  const results = all("SELECT * FROM results WHERE run_id=? ORDER BY rowid", runId);
  const stories = new Map<string, Row>();
  for (const r of results) {
    const tc = r.test_case_id ? get("test_cases", r.test_case_id) : undefined;
    if (tc?.story_id && !stories.has(tc.story_id)) stories.set(tc.story_id, get("stories", tc.story_id)!);
  }
  const ctx: RunCtx = {
    runId,
    project,
    baseUrl,
    vars: resolveVariables(project),
    secrets: secretKeys(project),
    variablesText: describeVariables(project),
    stories,
    currentResultId: null,
    auditor: null as unknown as FrontendAuditor,
  };
  ctx.auditor = new FrontendAuditor({
    enabled: settings.runner.frontendReview,
    maxVisualReviews: settings.runner.maxVisualReviews,
    device: run.device,
    storyText: [...stories.values()].map(storyBlock).join("\n\n---\n\n"),
    requirementsText: [...stories.values()].map((s) => requirementsBlock(s)).join("\n"),
    dir: path.join(runDir, "frontend"),
    onFindings: (findings) => saveFrontendFindings(ctx, findings),
    log: (msg) => log(runId, "warn", msg),
  });

  const browser = await chromium.launch({ headless: settings.runner.headless });
  try {
    // Device presets also carry launch-level hints (browser type, Edge channel); every device is emulated on Chromium.
    const preset = ((devices as Record<string, BrowserContextOptions & { defaultBrowserType?: string; channel?: string }>)[run.device] ?? devices["Desktop Chrome"]) as BrowserContextOptions & { defaultBrowserType?: string; channel?: string };
    const { defaultBrowserType: _type, channel: _channel, ...device } = preset;
    const contextOptions = (dir: string, storageState?: string): BrowserContextOptions => ({
      ...device,
      ignoreHTTPSErrors: true,
      storageState,
      recordVideo: settings.runner.video ? { dir, size: device.viewport ?? { width: 1280, height: 720 } } : undefined,
    });

    // Sign in once and reuse the session for every test that needs it.
    let authState: string | undefined;
    let loginError: string | null = null;
    if (ctx.vars.USERNAME && results.some((r) => r.test_case.requires_login)) {
      log(runId, "info", "Signing in once to reuse the session for all signed-in tests…");
      const dir = path.join(runDir, "login");
      const bctx = await browser.newContext(contextOptions(dir));
      const out = await runAgent(bctx, ctx, { resultId: "login", tc: LOGIN_CASE(project), dir, loggedIn: false, startUrl: project.login_url, audit: false });
      if (out.status === "passed") {
        authState = path.join(dir, "auth.json");
        await bctx.storageState({ path: authState });
        log(runId, "info", "Signed in.");
      } else {
        const lastError = [...out.steps].reverse().find((s) => !s.ok);
        loginError = `Sign-in failed: ${out.summary}${lastError ? ` (last error: ${lastError.action.description} -> ${lastError.result})` : ""}`;
        log(runId, "error", loginError);
      }
      await bctx.close();
    }

    for (const result of results) {
      if (cancelled.has(runId)) break;
      const tc = result.test_case as TestCaseSnapshot;
      if (tc.requires_login && !ctx.vars.USERNAME) {
        saveResult(ctx, result.id, { status: "blocked", summary: "This test needs a signed-in user but the project has no login credentials.", steps: [], checks: [], defects: [], videoPath: null }, null, 0);
        continue;
      }
      if (tc.requires_login && loginError) {
        saveResult(ctx, result.id, { status: "blocked", summary: loginError, steps: [], checks: [], defects: [], videoPath: null }, null, 0);
        continue;
      }
      update("results", result.id, { status: "running", started_at: now() });
      emit(runId, { type: "result", result: get("results", result.id)! });
      ctx.currentResultId = result.id;

      const started = Date.now();
      let attempt = await attemptTest(browser, contextOptions, ctx, { resultId: result.id, tc, authState, attemptNo: 1 });
      if (attempt.outcome.status === "failed" && settings.runner.confirmFailures && !cancelled.has(runId)) {
        log(runId, "info", `${tc.code} failed - re-running once to confirm…`);
        const second = await attemptTest(browser, contextOptions, ctx, { resultId: result.id, tc, authState, attemptNo: 2 });
        if (second.outcome.status === "passed") {
          const firstSummary = attempt.outcome.summary;
          attempt = { ...second, outcome: { ...second.outcome, status: "flaky", summary: `Failed on the first attempt (${firstSummary}), passed on retry.` } };
        }
      }
      saveResult(ctx, result.id, attempt.outcome, attempt.tracePath, Date.now() - started);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (cancelled.has(runId)) {
    cancelled.delete(runId);
    return finishRun(runId, "cancelled");
  }
  await summarize(runId).catch((e) => log(runId, "warn", `Summary skipped: ${(e as Error).message}`));
  finishRun(runId, "completed");
}

async function attemptTest(
  browser: Browser,
  contextOptions: (dir: string, state?: string) => BrowserContextOptions,
  ctx: RunCtx,
  a: { resultId: string; tc: TestCaseSnapshot; authState?: string; attemptNo: number },
) {
  const dir = path.join(ARTIFACTS_DIR, ctx.runId, a.resultId, `attempt-${a.attemptNo}`);
  const useAuth = a.tc.requires_login ? a.authState : undefined;
  const bctx = await browser.newContext(contextOptions(dir, useAuth));
  const settings = getSettings();
  if (settings.runner.trace) await bctx.tracing.start({ screenshots: true, snapshots: true });
  const outcome = await runAgent(bctx, ctx, { resultId: a.resultId, tc: a.tc, dir, loggedIn: !!useAuth, audit: true });
  let tracePath: string | null = null;
  if (settings.runner.trace) {
    tracePath = path.join(dir, "trace.zip");
    await bctx.tracing.stop({ path: tracePath }).catch(() => (tracePath = null));
  }
  await bctx.close();
  return { outcome, tracePath };
}

async function runAgent(bctx: BrowserContext, ctx: RunCtx, a: { resultId: string; tc: TestCaseSnapshot; dir: string; loggedIn: boolean; startUrl?: string; audit: boolean }) {
  const story = [...ctx.stories.values()].find((s) => ((s.requirements ?? []) as Row[]).some((r) => a.tc.requirement_ids?.includes(r.id)));
  try {
    return await runTestCase({
      context: bctx,
      testCase: a.tc,
      baseUrl: ctx.baseUrl,
      startUrl: a.startUrl,
      loggedIn: a.loggedIn,
      vars: ctx.vars,
      secretKeys: ctx.secrets,
      variablesText: ctx.variablesText,
      requirementsText: story ? requirementsBlock(story, a.tc.requirement_ids) : "",
      appContext: ctx.project.app_context,
      dir: a.dir,
      maxSteps: getSettings().runner.maxSteps,
      auditor: a.audit ? ctx.auditor : undefined,
      onStep: (step) => emit(ctx.runId, { type: "step", resultId: a.resultId, step: step as unknown as Record<string, unknown> }),
      onThinking: (text) => emit(ctx.runId, { type: "thinking", resultId: a.resultId, text }),
      onFrame: (data) => emit(ctx.runId, { type: "frame", resultId: a.resultId, data }),
      isCancelled: () => cancelled.has(ctx.runId),
    });
  } catch (e) {
    return { status: "error", summary: (e as Error).message, steps: [], checks: [], defects: [], videoPath: null } as TestOutcome;
  }
}

const PRIORITY: Record<string, string> = { critical: "Highest", major: "High", minor: "Medium", trivial: "Low" };

function saveResult(ctx: RunCtx, resultId: string, o: TestOutcome, tracePath: string | null, durationMs: number) {
  update("results", resultId, {
    status: o.status,
    summary: o.summary,
    steps: o.steps,
    checks: o.checks,
    trace_path: tracePath,
    video_path: o.videoPath,
    duration_ms: durationMs,
    finished_at: now(),
  });
  const result = get("results", resultId)!;
  if (o.status === "failed") {
    const tc = result.test_case as TestCaseSnapshot;
    for (const d of o.defects) {
      const check = tc.checks?.find((c) => c.id === d.check_id);
      insert("issues", {
        project_id: ctx.project.id,
        run_id: ctx.runId,
        result_id: resultId,
        test_case_code: tc.code,
        category: d.category,
        check_id: d.check_id,
        requirement_ids: check?.requirement_ids ?? tc.requirement_ids ?? [],
        title: d.title,
        description: `Found by automated test ${tc.code} "${tc.title}"${d.check_id ? `, check ${d.check_id}` : ""}.\n${o.summary}`,
        steps_to_reproduce: d.steps_to_reproduce,
        expected: d.expected,
        actual: d.actual,
        severity: d.severity,
        ai_comment: d.comment,
        page_url: d.pageUrl,
        console_errors: d.consoleErrors,
        screenshot_path: d.screenshotPath,
        priority: PRIORITY[d.severity] ?? "Medium",
        jira_project_key: ctx.project.jira_project_key,
        created_at: now(),
        updated_at: now(),
      });
    }
  }
  emit(ctx.runId, { type: "result", result });
}

/** Front-end findings become draft issues, skipping ones already open in this project. */
function saveFrontendFindings(ctx: RunCtx, findings: FrontendFinding[]) {
  const resultId = ctx.currentResultId;
  const result = resultId ? get("results", resultId) : undefined;
  const tc = result?.test_case as TestCaseSnapshot | undefined;
  for (const f of findings) {
    const open = all("SELECT id FROM issues WHERE project_id=? AND fingerprint=? AND status IN ('draft','approved','sent')", ctx.project.id, f.fingerprint);
    if (open.length) continue;
    insert("issues", {
      project_id: ctx.project.id,
      run_id: ctx.runId,
      result_id: resultId,
      test_case_code: tc?.code ?? null,
      category: f.category,
      fingerprint: f.fingerprint,
      title: f.title,
      description: `${f.source === "visual-review" ? "Found by Claude's visual review" : f.source === "accessibility-scan" ? "Found by the accessibility scan (axe-core)" : "Found by the layout scan"} while running ${tc ? `${tc.code} "${tc.title}"` : "the test run"}.\n\n${f.description}`,
      steps_to_reproduce: [`Open ${f.url}`, ...(tc ? [`Reach this screen as in ${tc.code}`] : [])],
      expected: f.expected,
      actual: f.description.split("\n")[0],
      severity: f.severity,
      ai_comment: "",
      page_url: f.url,
      screenshot_path: f.screenshotPath,
      priority: PRIORITY[f.severity] ?? "Medium",
      jira_project_key: ctx.project.jira_project_key,
      created_at: now(),
      updated_at: now(),
    });
    log(ctx.runId, "warn", `Front-end: ${f.title}`);
  }
  if (resultId) {
    const prev = (get("results", resultId)?.frontend as string[]) ?? [];
    update("results", resultId, { frontend: [...prev, ...findings.map((f) => f.fingerprint)] });
  }
}

async function summarize(runId: string) {
  const results = all("SELECT test_case, status, summary, checks FROM results WHERE run_id=?", runId);
  if (!results.length) return;
  const issues = all("SELECT category, severity, title FROM issues WHERE run_id=?", runId);
  const lines = results.map((r) => {
    const checks = (r.checks as Row[]) ?? [];
    const failed = checks.filter((c) => c.status === "failed").map((c) => c.id);
    return `${r.test_case.code} [${r.status}] ${r.test_case.title}${failed.length ? ` (failed checks: ${failed.join(", ")})` : ""}: ${r.summary ?? ""}`;
  });
  const summary = await aiJson({
    system: SUMMARY_SYSTEM,
    prompt: `Test results:\n${lines.join("\n")}\n\nDefects found (${issues.length}):\n${issues.map((i) => `[${i.category}/${i.severity}] ${i.title}`).join("\n") || "(none)"}\n\nWrite the release-readiness summary.`,
    schema: RunSummary,
    effort: "low",
    maxTokens: 4000,
  });
  update("runs", runId, { ai_summary: JSON.stringify(summary) });
}

function log(runId: string, level: "info" | "warn" | "error", message: string) {
  emit(runId, { type: "log", level, message });
}
