import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { AiError, testAi } from "../ai/claude";
import { ARTIFACTS_DIR, artifactUrl, REPOS_DIR } from "../config";
import { encrypt } from "../crypto";
import { all, db, get, insert, now, remove, Row, update } from "../db";
import { cancelRun, DEVICES, enqueueRun } from "../runner/queue";
import { analyzeRepo } from "../services/repo";
import { buildRunReport } from "../services/report";
import { issueTypes, JiraError, listProjects, searchUsers, sendIssueToJira, testJira } from "../services/jira";
import { MailboxError, testMailbox } from "../services/mailbox";
import { exportStory, importRows, nextCodeFn, parseDelimited, previewGrid, readGoogleSheet, readWorkbook, SheetError, type Grid } from "../services/sheets";
import { generateSpec, REPORTS_DIR, saveSpecCode, startSuiteRun, SuiteError, SUITES_DIR, suiteZip } from "../services/suite";
import { analyzeStory, coverage, expandChecks, generateTestCases, importTestCases } from "../services/testcases";
import { mergeVariables, variablesView } from "../services/variables";
import { getSettings, publicSettings, saveSettings } from "../settings";

export const api = express.Router();

// No route here uses wildcard params, so every req.params value is a plain string.
type Handler = (req: Request<Record<string, string>>, res: Response) => Promise<unknown> | unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req as Request<Record<string, string>>, res))
    .then((out) => {
      if (!res.headersSent) res.json(out ?? { ok: true });
    })
    .catch(next);

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
function must<T>(v: T | undefined | null, what = "Not found"): T {
  if (v == null) throw new HttpError(404, what);
  return v;
}
const inList = (ids: string[]) => ids.map(() => "?").join(",");

// ---------------------------------------------------------------- view mappers

function projectView(p: Row) {
  const { password_enc, git_token_enc, variables, ...rest } = p;
  return { ...rest, variables: variablesView(p), has_password: !!password_enc, has_git_token: !!git_token_enc };
}

function resultView(r: Row) {
  return { ...r, trace_url: artifactUrl(r.trace_path), video_url: artifactUrl(r.video_path) };
}

function issueView(i: Row) {
  return { ...i, screenshot_url: artifactUrl(i.screenshot_path), annotated_url: artifactUrl(i.annotated_path) };
}

function runView(r: Row) {
  const counts = db.prepare("SELECT status, COUNT(*) n FROM results WHERE run_id=? GROUP BY status").all(r.id) as { status: string; n: number }[];
  const issues = db.prepare("SELECT category, COUNT(*) n FROM issues WHERE run_id=? GROUP BY category").all(r.id) as { category: string; n: number }[];
  const build = r.build_id ? get("builds", r.build_id) : null;
  return {
    ...r,
    ai_summary: r.ai_summary ? JSON.parse(r.ai_summary) : null,
    build_version: build?.version ?? null,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    issue_counts: Object.fromEntries(issues.map((c) => [c.category, c.n])),
    total: counts.reduce((a, c) => a + c.n, 0),
  };
}

function storyView(s: Row) {
  const cases = db.prepare("SELECT COUNT(*) n FROM test_cases WHERE story_id=?").get(s.id) as { n: number };
  const imp = all("SELECT result_columns, source, sheet_name FROM sheet_imports WHERE story_id=? ORDER BY created_at DESC LIMIT 1", s.id)[0];
  return { ...s, test_case_count: cases.n, coverage: coverage(s.id), sheet: imp ?? null };
}

function suiteRunView(r: Row) {
  return { ...r, summary: r.summary ? JSON.parse(r.summary) : null, report_url: `/reports/${r.id}/html/index.html` };
}

const PROJECT_FIELDS = ["name", "site_url", "git_url", "git_branch", "login_url", "username", "login_notes", "jira_project_key", "default_device", "app_context"];
function projectInput(body: any, existing?: Row) {
  const out: Row = {};
  for (const k of PROJECT_FIELDS) if (body[k] !== undefined) out[k] = typeof body[k] === "string" ? body[k].trim() : body[k];
  if (typeof body.password === "string" && body.password) out.password_enc = encrypt(body.password);
  if (body.password === null) out.password_enc = null;
  if (typeof body.git_token === "string" && body.git_token) out.git_token_enc = encrypt(body.git_token);
  if (body.git_token === null) out.git_token_enc = null;
  if (Array.isArray(body.variables)) out.variables = mergeVariables(existing, body.variables);
  return out;
}

// ---------------------------------------------------------------- settings & dashboard

api.get("/meta", h(() => ({ devices: DEVICES })));
api.get("/settings", h(() => publicSettings()));
api.put("/settings", h((req) => saveSettings(req.body)));
api.post("/settings/test-ai", h(async () => ({ message: await testAi() })));
api.post("/settings/test-jira", h(async () => ({ message: await testJira() })));
api.post("/settings/test-mailbox", h(async () => ({ message: await testMailbox() })));

api.get(
  "/dashboard",
  h(() => {
    const projects = all("SELECT * FROM projects ORDER BY created_at DESC").map((p) => ({
      ...projectView(p),
      stories: (db.prepare("SELECT COUNT(*) n FROM stories WHERE project_id=?").get(p.id) as { n: number }).n,
      test_cases: (db.prepare("SELECT COUNT(*) n FROM test_cases WHERE project_id=?").get(p.id) as { n: number }).n,
      open_issues: (db.prepare("SELECT COUNT(*) n FROM issues WHERE project_id=? AND status IN ('draft','approved')").get(p.id) as { n: number }).n,
      specs: (db.prepare("SELECT COUNT(*) n FROM specs WHERE project_id=?").get(p.id) as { n: number }).n,
    }));
    const runs = all("SELECT r.*, p.name AS project_name FROM runs r JOIN projects p ON p.id=r.project_id ORDER BY r.created_at DESC LIMIT 12").map(runView);
    const totals = db.prepare("SELECT status, COUNT(*) n FROM results WHERE status NOT IN ('pending','running','cancelled') GROUP BY status").all() as { status: string; n: number }[];
    const issues = db.prepare("SELECT category, COUNT(*) n FROM issues WHERE status IN ('draft','approved') GROUP BY category").all() as { category: string; n: number }[];
    return { projects, runs, totals: Object.fromEntries(totals.map((t) => [t.status, t.n])), open_issues: Object.fromEntries(issues.map((t) => [t.category, t.n])) };
  }),
);

// ---------------------------------------------------------------- projects

api.get("/projects", h(() => all("SELECT * FROM projects ORDER BY created_at DESC").map(projectView)));
api.post(
  "/projects",
  h((req) => {
    const input = projectInput(req.body);
    if (!input.name || !input.site_url) throw new HttpError(400, "Name and site URL are required.");
    return projectView(insert("projects", { default_device: "Desktop Chrome", ...input, created_at: now() }));
  }),
);
api.get("/projects/:id", h((req) => projectView(must(get("projects", req.params.id)))));
api.put("/projects/:id", h((req) => projectView(must(update("projects", req.params.id, projectInput(req.body, get("projects", req.params.id)))))));
/** Delete a run's screenshots, videos and traces from disk (the DB rows cascade separately). */
function removeRunFiles(runId: string) {
  fs.rmSync(path.join(ARTIFACTS_DIR, runId), { recursive: true, force: true });
}

api.delete(
  "/projects/:id",
  h((req) => {
    const id = req.params.id;
    for (const r of all("SELECT id FROM runs WHERE project_id=?", id)) removeRunFiles(r.id);
    for (const r of all("SELECT id FROM suite_runs WHERE project_id=?", id)) fs.rmSync(path.join(REPORTS_DIR, r.id), { recursive: true, force: true });
    fs.rmSync(path.join(SUITES_DIR, id), { recursive: true, force: true });
    fs.rmSync(path.join(REPOS_DIR, id), { recursive: true, force: true });
    remove("projects", id);
  }),
);
api.post("/projects/:id/analyze-repo", h(async (req) => projectView(must(await analyzeRepo(must(get("projects", req.params.id)), req.body?.branch)))));

// ---------------------------------------------------------------- stories

api.get("/projects/:id/stories", h((req) => all("SELECT * FROM stories WHERE project_id=? ORDER BY created_at DESC", req.params.id).map(storyView)));
api.post(
  "/projects/:id/stories",
  h((req) => {
    const { title, description = "", acceptance_criteria = "", jira_key = null } = req.body;
    if (!title) throw new HttpError(400, "Title is required.");
    return storyView(insert("stories", { project_id: req.params.id, title, description, acceptance_criteria, jira_key, created_at: now() }));
  }),
);
api.get("/stories/:id", h((req) => storyView(must(get("stories", req.params.id)))));
api.put(
  "/stories/:id",
  h((req) => {
    const { title, description, acceptance_criteria, jira_key, requirements, review } = req.body;
    return storyView(must(update("stories", req.params.id, { title, description, acceptance_criteria, jira_key, requirements, review })));
  }),
);
api.delete("/stories/:id", h((req) => remove("stories", req.params.id)));
api.post(
  "/stories/:id/analyze",
  h(async (req) => {
    const story = must(get("stories", req.params.id));
    return storyView(await analyzeStory(must(get("projects", story.project_id)), story));
  }),
);

// ---------------------------------------------------------------- test cases

api.post(
  "/stories/:id/generate",
  h(async (req) => {
    const story = must(get("stories", req.params.id));
    return generateTestCases(must(get("projects", story.project_id)), story, req.body?.guidance);
  }),
);
api.post(
  "/stories/:id/import",
  h(async (req) => {
    const story = must(get("stories", req.params.id));
    if (!req.body?.text?.trim()) throw new HttpError(400, "Paste the test cases first.");
    return importTestCases(must(get("projects", story.project_id)), story, req.body.text);
  }),
);
api.post(
  "/stories/:id/expand",
  h(async (req) => {
    const story = must(get("stories", req.params.id));
    return expandChecks(must(get("projects", story.project_id)), story, req.body?.testCaseIds);
  }),
);

/** Read a spreadsheet from a Google Sheets link, an uploaded .xlsx/.csv, or pasted cells. */
async function readSheetSource(body: any): Promise<{ grid?: Grid; name: string | null; sheets?: string[]; source: string }> {
  if (body.url) {
    const { grid, name } = await readGoogleSheet(String(body.url));
    return { grid, name, source: String(body.url) };
  }
  if (body.fileBase64) {
    const fileName = String(body.fileName ?? "upload");
    if (/\.csv$/i.test(fileName) || /\.tsv$/i.test(fileName)) return { grid: parseDelimited(Buffer.from(body.fileBase64, "base64").toString("utf8")), name: fileName, source: fileName };
    const sheets = await readWorkbook(body.fileBase64);
    const chosen = body.sheetName ? sheets.find((s) => s.name === body.sheetName) : sheets.length === 1 ? sheets[0] : undefined;
    if (!chosen) return { sheets: sheets.map((s) => s.name), name: null, source: fileName };
    return { grid: chosen.grid, name: chosen.name, source: fileName };
  }
  if (body.text) return { grid: parseDelimited(String(body.text)), name: null, source: "pasted" };
  throw new HttpError(400, "Provide a Google Sheets link, a file, or pasted cells.");
}

api.post(
  "/stories/:id/import-sheet",
  h(async (req) => {
    const story = must(get("stories", req.params.id));
    const project = must(get("projects", story.project_id));
    const src = await readSheetSource(req.body);
    if (!src.grid) return { sheets: src.sheets };
    const preview = await previewGrid(src.grid);
    if (req.body.mapping) preview.mapping = { ...preview.mapping, ...req.body.mapping };
    if (!req.body.commit) {
      return { name: src.name, headers: preview.headers, mapping: preview.mapping, total: preview.rows.length, rows: preview.rows.slice(0, 50) };
    }
    const created = importRows(project, story, src.source, src.name, preview);
    return { imported: created.length, test_cases: created };
  }),
);

api.get(
  "/stories/:id/export.xlsx",
  h(async (req, res) => {
    const column = String(req.query.column || "Result");
    const { buffer, filename } = await exportStory(req.params.id, column, (req.query.runId as string) || undefined);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
    res.send(buffer);
  }),
);

api.get(
  "/projects/:id/testcases",
  h((req) =>
    req.query.storyId
      ? all("SELECT * FROM test_cases WHERE project_id=? AND story_id=? ORDER BY sort, code", req.params.id, req.query.storyId)
      : all("SELECT * FROM test_cases WHERE project_id=? ORDER BY story_id, sort, code", req.params.id),
  ),
);
api.get(
  "/stories/:id/testcases",
  h((req) => {
    const cases = all("SELECT * FROM test_cases WHERE story_id=? ORDER BY sort, code", req.params.id);
    if (!cases.length) return [];
    // Attach the latest finished result and spec status for the table.
    const latest = all(
      `SELECT r.test_case_id, r.status, r.id, r.run_id FROM results r JOIN runs ru ON ru.id=r.run_id WHERE r.test_case_id IN (${inList(cases.map((c) => c.id))}) AND r.status NOT IN ('pending','running','cancelled') ORDER BY ru.created_at ASC`,
      ...cases.map((c) => c.id),
    );
    const last = new Map(latest.map((r) => [r.test_case_id, r]));
    const specs = new Map(all(`SELECT test_case_id, status, id FROM specs WHERE test_case_id IN (${inList(cases.map((c) => c.id))})`, ...cases.map((c) => c.id)).map((s) => [s.test_case_id, s]));
    return cases.map((c) => ({ ...c, last_result: last.get(c.id) ?? null, spec: specs.get(c.id) ?? null }));
  }),
);
const TC_FIELDS = ["code", "title", "type", "priority", "preconditions", "requires_login", "steps", "test_data", "expected_result", "enabled", "owner", "checks", "requirement_ids", "automation"];
api.post(
  "/stories/:id/testcases",
  h((req) => {
    const story = must(get("stories", req.params.id));
    const data: Row = { steps: [], requires_login: false, type: "Functional" };
    for (const k of TC_FIELDS) if (req.body[k] !== undefined) data[k] = req.body[k];
    const sort = (db.prepare("SELECT COALESCE(MAX(sort),0) m FROM test_cases WHERE story_id=?").get(story.id) as { m: number }).m + 1;
    return insert("test_cases", { code: nextCodeFn(story.project_id)(), ...data, project_id: story.project_id, story_id: story.id, source: "manual", sort, created_at: now() });
  }),
);
api.put(
  "/testcases/:id",
  h((req) => {
    const data: Row = {};
    for (const k of TC_FIELDS) if (req.body[k] !== undefined) data[k] = req.body[k];
    return must(update("test_cases", req.params.id, data));
  }),
);
api.delete("/testcases/:id", h((req) => remove("test_cases", req.params.id)));
api.post(
  "/testcases/bulk-delete",
  h((req) => {
    const ids: string[] = req.body?.ids ?? [];
    if (ids.length) db.prepare(`DELETE FROM test_cases WHERE id IN (${inList(ids)})`).run(...ids);
  }),
);

// ---------------------------------------------------------------- builds

api.get("/projects/:id/builds", h((req) => all("SELECT * FROM builds WHERE project_id=? ORDER BY created_at DESC", req.params.id)));
api.post(
  "/projects/:id/builds",
  h((req) => {
    const { version, branch = null, commit_sha = null, site_url = null, notes = null, created_by = null } = req.body;
    if (!version) throw new HttpError(400, "Version is required.");
    return insert("builds", { project_id: req.params.id, version, branch, commit_sha, site_url: site_url || null, notes, created_by, created_at: now() });
  }),
);
api.delete("/builds/:id", h((req) => remove("builds", req.params.id)));

// ---------------------------------------------------------------- runs

function createRun(projectId: string, opts: { buildId?: string | null; testCaseIds?: string[]; device?: string; name?: string }) {
  const project = must(get("projects", projectId), "Project not found");
  const cases = opts.testCaseIds?.length
    ? all(`SELECT * FROM test_cases WHERE project_id=? AND id IN (${inList(opts.testCaseIds)}) ORDER BY story_id, sort, code`, projectId, ...opts.testCaseIds)
    : all("SELECT * FROM test_cases WHERE project_id=? AND enabled=1 AND automation!='manual' ORDER BY story_id, sort, code", projectId);
  if (!cases.length) throw new HttpError(400, "No test cases selected.");
  const build = opts.buildId ? get("builds", opts.buildId) : null;
  const run = db.transaction(() => {
    const run = insert("runs", {
      project_id: projectId,
      build_id: build?.id ?? null,
      name: opts.name || `Run ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}${build ? ` · ${build.version}` : ""}`,
      device: opts.device || project.default_device,
      created_at: now(),
    });
    for (const tc of cases) {
      const { code, title, type, priority, preconditions, requires_login, steps, test_data, expected_result, checks, requirement_ids } = tc;
      insert("results", { run_id: run.id, test_case_id: tc.id, test_case: { code, title, type, priority, preconditions, requires_login, steps, test_data, expected_result, checks, requirement_ids } });
    }
    return run;
  })();
  enqueueRun(run.id);
  return runView(run);
}

api.get(
  "/projects/:id/runs",
  h((req) => {
    const storyId = req.query.storyId as string | undefined;
    const runs = storyId
      ? all("SELECT DISTINCT ru.* FROM runs ru JOIN results r ON r.run_id=ru.id JOIN test_cases t ON t.id=r.test_case_id WHERE ru.project_id=? AND t.story_id=? ORDER BY ru.created_at DESC", req.params.id, storyId)
      : all("SELECT * FROM runs WHERE project_id=? ORDER BY created_at DESC", req.params.id);
    return runs.map(runView);
  }),
);
api.post("/runs", h((req) => createRun(req.body.projectId, req.body)));
api.get(
  "/runs/:id",
  h((req) => {
    const run = must(get("runs", req.params.id));
    return {
      run: runView(run),
      project: projectView(get("projects", run.project_id)!),
      build: run.build_id ? get("builds", run.build_id) : null,
      results: all("SELECT * FROM results WHERE run_id=? ORDER BY rowid", run.id).map(resultView),
      issues: all("SELECT * FROM issues WHERE run_id=? ORDER BY created_at", run.id).map(issueView),
      specs: all(`SELECT id, test_case_id, status, result_id FROM specs WHERE project_id=?`, run.project_id),
    };
  }),
);
api.post("/runs/:id/cancel", h((req) => cancelRun(req.params.id)));
api.post(
  "/runs/:id/rerun",
  h((req) => {
    const old = must(get("runs", req.params.id));
    const failedOnly = !!req.body?.failedOnly;
    const ids = all(`SELECT test_case_id FROM results WHERE run_id=? ${failedOnly ? "AND status IN ('failed','blocked','error','flaky')" : ""}`, old.id)
      .map((r) => r.test_case_id)
      .filter(Boolean);
    return createRun(old.project_id, { buildId: old.build_id, testCaseIds: ids, device: old.device });
  }),
);
api.delete(
  "/runs/:id",
  h((req) => {
    const run = must(get("runs", req.params.id));
    if (["queued", "running"].includes(run.status)) throw new HttpError(400, "Stop the run before deleting it.");
    removeRunFiles(run.id);
    remove("runs", run.id);
  }),
);
api.get(
  "/runs/:id/report.html",
  h((req, res) => {
    const run = must(get("runs", req.params.id));
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename="qa-report-${run.id.slice(0, 8)}.html"`);
    res.send(buildRunReport(run.id));
  }),
);

// ---------------------------------------------------------------- Playwright suite

api.get(
  "/projects/:id/specs",
  h((req) =>
    all(
      "SELECT s.*, t.code AS tc_code, t.title, t.story_id, st.title AS story_title FROM specs s LEFT JOIN test_cases t ON t.id=s.test_case_id LEFT JOIN stories st ON st.id=t.story_id WHERE s.project_id=? ORDER BY s.file",
      req.params.id,
    ),
  ),
);
api.post("/results/:id/spec", h(async (req) => generateSpec(req.params.id)));
api.post(
  "/runs/:id/specs",
  h(async (req) => {
    // Generate specs for every result of a run that has a recording (sequentially, each is validated by running it).
    const results = all("SELECT id FROM results WHERE run_id=? AND status IN ('passed','failed','flaky') AND test_case_id IS NOT NULL", req.params.id);
    const out = [];
    for (const r of results) {
      try {
        out.push(await generateSpec(r.id));
      } catch (e) {
        out.push({ result_id: r.id, error: (e as Error).message });
      }
    }
    return out;
  }),
);
api.put("/specs/:id", h((req) => saveSpecCode(req.params.id, String(req.body?.code ?? ""))));
api.delete(
  "/specs/:id",
  h((req) => {
    const spec = must(get("specs", req.params.id));
    remove("specs", spec.id);
  }),
);
api.get("/projects/:id/suite-runs", h((req) => all("SELECT * FROM suite_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 30", req.params.id).map(suiteRunView)));
api.post("/projects/:id/suite-runs", h((req) => suiteRunView(startSuiteRun(req.params.id, req.body?.specIds, req.body?.device || "Desktop Chrome"))));
api.get("/suite-runs/:id", h((req) => suiteRunView(must(get("suite_runs", req.params.id)))));
api.get(
  "/projects/:id/suite.zip",
  h(async (req, res) => {
    must(get("projects", req.params.id));
    const { buffer, filename } = await suiteZip(req.params.id);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

// ---------------------------------------------------------------- issues

api.get(
  "/projects/:id/issues",
  h((req) => {
    const where = ["project_id=?"];
    const params: unknown[] = [req.params.id];
    if (req.query.status) (where.push("status=?"), params.push(req.query.status));
    if (req.query.category) (where.push("category=?"), params.push(req.query.category));
    if (req.query.runId) (where.push("run_id=?"), params.push(req.query.runId));
    return all(`SELECT * FROM issues WHERE ${where.join(" AND ")} ORDER BY created_at DESC`, ...params).map(issueView);
  }),
);
api.get("/issues/:id", h((req) => issueView(must(get("issues", req.params.id)))));
const ISSUE_FIELDS = ["title", "description", "steps_to_reproduce", "expected", "actual", "severity", "category", "ai_comment", "reviewer_comment", "status", "issue_type", "priority", "assignee_id", "assignee_name", "jira_project_key"];
api.put(
  "/issues/:id",
  h((req) => {
    const data: Row = { updated_at: now() };
    for (const k of ISSUE_FIELDS) if (req.body[k] !== undefined) data[k] = req.body[k];
    return issueView(must(update("issues", req.params.id, data)));
  }),
);
api.post(
  "/issues/bulk",
  h((req) => {
    const ids: string[] = req.body?.ids ?? [];
    const status = req.body?.status;
    if (!ids.length || !["draft", "approved", "rejected"].includes(status)) throw new HttpError(400, "Choose issues and a status.");
    db.prepare(`UPDATE issues SET status=?, updated_at=? WHERE status!='sent' AND id IN (${inList(ids)})`).run(status, now(), ...ids);
  }),
);
api.delete("/issues/:id", h((req) => remove("issues", req.params.id)));
api.post(
  "/issues/:id/annotation",
  h((req) => {
    const issue = must(get("issues", req.params.id));
    const m = /^data:image\/png;base64,(.+)$/.exec(req.body?.dataUrl ?? "");
    if (!m || !issue.screenshot_path) throw new HttpError(400, "Expected a PNG data URL.");
    const file = path.join(path.dirname(issue.screenshot_path), `annotated-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from(m[1], "base64"));
    return issueView(update("issues", issue.id, { annotated_path: file, updated_at: now() })!);
  }),
);
api.post(
  "/issues/:id/jira",
  h(async (req) => {
    const issue = must(get("issues", req.params.id));
    try {
      return issueView(await sendIssueToJira(issue));
    } catch (e) {
      update("issues", issue.id, { jira_error: (e as Error).message, updated_at: now() });
      throw new HttpError(502, (e as Error).message);
    }
  }),
);
api.post(
  "/issues/send-approved",
  h(async (req) => {
    const issues = all("SELECT * FROM issues WHERE project_id=? AND status='approved'", req.body.projectId);
    const out = { sent: 0, failed: [] as { id: string; error: string }[] };
    for (const issue of issues) {
      try {
        await sendIssueToJira(issue);
        out.sent++;
      } catch (e) {
        update("issues", issue.id, { jira_error: (e as Error).message, updated_at: now() });
        out.failed.push({ id: issue.id, error: (e as Error).message });
      }
    }
    return out;
  }),
);

// ---------------------------------------------------------------- jira lookups

api.get("/jira/projects", h(() => listProjects()));
api.get("/jira/users", h((req) => searchUsers(String(req.query.project ?? ""), String(req.query.query ?? ""))));
api.get("/jira/issuetypes", h((req) => issueTypes(String(req.query.project ?? ""))));

// ---------------------------------------------------------------- CI webhook: developer hands over a build

api.post(
  "/hooks/build",
  h(async (req) => {
    if (req.get("x-qa-token") !== getSettings().webhookToken) throw new HttpError(401, "Invalid X-QA-Token.");
    const { projectId, version, branch = null, commit = null, siteUrl = null, notes = null, author = null, run = true, analyze = false, device } = req.body ?? {};
    const project = must(get("projects", projectId), "Project not found");
    if (!version) throw new HttpError(400, "version is required");
    const build = insert("builds", { project_id: project.id, version, branch, commit_sha: commit, site_url: siteUrl, notes, created_by: author, created_at: now() });
    if (analyze && project.git_url) await analyzeRepo(project, branch);
    return { build, run: run ? createRun(project.id, { buildId: build.id, device }) : null };
  }),
);

// ---------------------------------------------------------------- errors

api.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const known = err instanceof JiraError || err instanceof AiError || err instanceof SheetError || err instanceof SuiteError || err instanceof MailboxError;
  const status = err instanceof HttpError ? err.status : known ? 400 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message });
});
