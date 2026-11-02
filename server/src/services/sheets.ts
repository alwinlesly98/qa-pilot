import ExcelJS from "exceljs";
import { aiJson } from "../ai/claude";
import { MAPPING_SYSTEM } from "../ai/prompts";
import { ColumnMapping } from "../ai/schemas";
import { all, db, get, insert, now, Row } from "../db";

export class SheetError extends Error {}

export type Grid = string[][];
type Field = Exclude<keyof ColumnMapping, "header_row" | "result_columns">;

// ---------------------------------------------------------------- reading

/** RFC 4180 parser; also handles tab-separated text pasted from Google Sheets / Excel. */
export function parseDelimited(text: string): Grid {
  const delimiter = (text.split("\n")[0].match(/\t/g)?.length ?? 0) > 0 ? "\t" : ",";
  const rows: Grid = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

function parseGoogleUrl(url: string) {
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) return null;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return { id, gid };
}

export async function readGoogleSheet(url: string): Promise<{ grid: Grid; name: string }> {
  const ref = parseGoogleUrl(url);
  if (!ref) throw new SheetError("That is not a Google Sheets link.");
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${ref.id}/export?format=csv&gid=${ref.gid}`, { redirect: "follow" });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) {
    throw new SheetError(
      "Could not read the sheet. In Google Sheets choose Share → General access → 'Anyone with the link' (Viewer), or use File → Download → .xlsx and upload the file instead.",
    );
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? "").replace(/\.csv$/i, "") || "Google Sheet";
  return { grid: parseDelimited(await res.text()), name };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return String(v.result ?? "");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

/** Read an .xlsx upload. Returns every sheet so the user can pick the right tab. */
export async function readWorkbook(base64: string): Promise<{ name: string; grid: Grid }[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer);
  } catch {
    throw new SheetError("That file is not a readable .xlsx workbook.");
  }
  return wb.worksheets.map((ws) => {
    const grid: Grid = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) values.push(cellText(row.getCell(c).value).trim());
      if (values.some(Boolean)) grid.push(values);
    });
    return { name: ws.name, grid };
  });
}

// ---------------------------------------------------------------- column detection

const PATTERNS: [Field, RegExp][] = [
  ["code", /^(test\s*case\s*(no|id|#|number)\.?|tc\s*(id|no)\.?|id|s\.?\s*no\.?|case\s*id)$/i],
  ["preconditions", /pre-?\s*condition/i],
  ["steps", /step/i],
  ["test_data", /test\s*(input|data)|^input|^data$/i],
  ["expected", /expected/i],
  ["type", /(test\s*)?type|category/i],
  ["owner", /^(qa|tester|owner|assignee|executed\s*by|author)$/i],
  ["remarks", /remark|comment|^notes?$/i],
  ["title", /scenario|title|summary|test\s*case(\s*name|\s*description)?$|description/i],
];
const RESULT_RE = /result|status|pass|fail|^(web|ios|android|chrome|safari|firefox|edge|mobile|desktop)|v\s?\d|build|sprint|round|cycle/i;

const ID_RE = /^[A-Za-z]{1,8}[-_ ]?[A-Za-z]{0,6}[-_ ]?\d{1,5}$/;

/** A column where (nearly) every filled cell looks like a test case ID such as TC_01 or VC-TC-12. */
function idColumn(rows: Grid): number | null {
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let c = 0; c < Math.min(width, 4); c++) {
    const values = rows.map((r) => (r[c] ?? "").trim()).filter(Boolean);
    if (values.length >= 2 && values.filter((v) => ID_RE.test(v)).length / values.length >= 0.8 && new Set(values).size === values.length) return c;
  }
  return null;
}

function heuristicMapping(grid: Grid): ColumnMapping | null {
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const headers = grid[r].map((h) => h.trim());
    const mapping: Record<string, number | null> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      for (const [field, re] of PATTERNS) {
        if (mapping[field] == null && re.test(h)) {
          mapping[field] = i;
          return;
        }
      }
    });
    // Headers are sometimes wrong (e.g. column A labelled "Remarks" but holding TC_01, TC_02…): trust the values.
    const idCol = idColumn(grid.slice(r + 1));
    if (idCol != null && mapping.code !== idCol) {
      for (const k of Object.keys(mapping)) if (mapping[k] === idCol) mapping[k] = null;
      mapping.code = idCol;
      if (mapping.remarks == null) {
        const other = headers.findIndex((h, i) => i !== idCol && /remark|comment|^notes?$/i.test(h));
        if (other >= 0) mapping.remarks = other;
      }
    }
    const found = Object.values(mapping).filter((v) => v != null).length;
    if (found >= 3 && (mapping.title != null || mapping.steps != null) && mapping.expected != null) {
      const used = new Set(Object.values(mapping));
      const result_columns = headers.map((h, i) => (h && !used.has(i) && RESULT_RE.test(h) ? i : -1)).filter((i) => i >= 0);
      const get = (f: Field) => mapping[f] ?? null;
      return {
        header_row: r, code: get("code"), title: get("title"), preconditions: get("preconditions"), steps: get("steps"), test_data: get("test_data"),
        expected: get("expected"), type: get("type"), owner: get("owner"), remarks: get("remarks"), result_columns,
      };
    }
  }
  return null;
}

export async function detectMapping(grid: Grid): Promise<ColumnMapping> {
  const quick = heuristicMapping(grid);
  if (quick) return quick;
  const preview = grid.slice(0, 8).map((r, i) => `${i}: ${r.map((c, j) => `[${j}] ${c.slice(0, 60)}`).join(" | ")}`).join("\n");
  return aiJson({ system: MAPPING_SYSTEM, prompt: `First rows of the sheet:\n${preview}\n\nIdentify the columns.`, schema: ColumnMapping, effort: "low", maxTokens: 4000 });
}

// ---------------------------------------------------------------- import

function nextCodeFn(projectId: string) {
  let n = 0;
  for (const r of db.prepare("SELECT code FROM test_cases WHERE project_id=?").all(projectId) as { code: string }[]) {
    n = Math.max(n, Number(r.code.match(/(\d+)\s*$/)?.[1] ?? 0));
  }
  return () => `TC-${String(++n).padStart(3, "0")}`;
}
export { nextCodeFn };

function splitSteps(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .flatMap((l) => l.split(/(?<=[.!?])\s*(?=\d+[.)]\s)/)) // "…OTP.6. Test…" pasted without a line break
    .map((s) => s.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;
  return text.split(/;\s*|\.\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
}

export interface ImportPreview {
  headers: string[];
  mapping: ColumnMapping;
  rows: Grid;
}

export async function previewGrid(grid: Grid): Promise<ImportPreview> {
  if (grid.length < 2) throw new SheetError("The sheet has no test case rows.");
  const mapping = await detectMapping(grid);
  const headers = grid[mapping.header_row] ?? [];
  const rows = grid.slice(mapping.header_row + 1).filter((r) => {
    const title = mapping.title != null ? r[mapping.title] : "";
    const steps = mapping.steps != null ? r[mapping.steps] : "";
    return (title || steps || "").trim().length > 0;
  });
  return { headers, mapping, rows };
}

/** Save previewed rows as test cases of the story, remembering the layout for export. */
export function importRows(project: Row, story: Row, source: string, sheetName: string | null, preview: ImportPreview) {
  const { headers, mapping, rows } = preview;
  const code = nextCodeFn(project.id);
  const at = (r: string[], i: number | null) => (i == null ? "" : (r[i] ?? "").trim());
  return db.transaction(() => {
    const imp = insert("sheet_imports", {
      project_id: project.id, story_id: story.id, source, sheet_name: sheetName, headers, mapping, result_columns: mapping.result_columns.map((i) => headers[i]).filter(Boolean),
      created_at: now(),
    });
    const base = (db.prepare("SELECT COALESCE(MAX(sort),0) m FROM test_cases WHERE story_id=?").get(story.id) as { m: number }).m;
    return rows.map((r, i) => {
      const stepsText = at(r, mapping.steps);
      return insert("test_cases", {
        project_id: project.id,
        story_id: story.id,
        code: at(r, mapping.code) || code(),
        title: at(r, mapping.title) || stepsText.slice(0, 120),
        type: at(r, mapping.type) || "Functional",
        priority: "medium",
        preconditions: at(r, mapping.preconditions),
        requires_login: false,
        steps: stepsText ? splitSteps(stepsText) : [],
        test_data: at(r, mapping.test_data),
        expected_result: at(r, mapping.expected),
        owner: at(r, mapping.owner) || null,
        source: "manual",
        enabled: true,
        import_id: imp.id,
        sheet_row: r,
        sort: base + i + 1,
        created_at: now(),
      });
    });
  })();
}

// ---------------------------------------------------------------- export

const STATUS_LABEL: Record<string, string> = { passed: "Pass", failed: "Fail", blocked: "Blocked", flaky: "Pass (flaky)", error: "Error", cancelled: "Not run" };
const DEFAULT_HEADERS = ["Test Case No.", "Test Scenario", "Pre-conditions", "Step Definition", "Test input", "Expected Result", "Test Type", "QA"];

function latestResults(testCaseIds: string[], runId?: string) {
  const map = new Map<string, Row>();
  if (!testCaseIds.length) return map;
  const rows = runId
    ? all(`SELECT * FROM results WHERE run_id=? AND test_case_id IN (${testCaseIds.map(() => "?").join(",")})`, runId, ...testCaseIds)
    : all(
        `SELECT r.* FROM results r JOIN runs ru ON ru.id=r.run_id WHERE r.test_case_id IN (${testCaseIds.map(() => "?").join(",")}) AND r.status NOT IN ('pending','running') ORDER BY ru.created_at ASC`,
        ...testCaseIds,
      );
  for (const r of rows) map.set(r.test_case_id, r); // later runs overwrite earlier ones
  return map;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 28;
}

function colorStatus(cell: ExcelJS.Cell) {
  const v = String(cell.value ?? "");
  const color = v.startsWith("Pass") ? "FFDCFCE7" : v === "Fail" ? "FFFEE2E2" : v === "Blocked" ? "FFFEF3C7" : null;
  if (color) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  cell.font = { bold: true };
}

/**
 * Workbook in the team's own layout: the chosen result column (e.g. "Web- V1.1") is filled
 * with Pass/Fail/Blocked and Remarks get the defects (with Jira keys) and blocked reasons.
 */
export async function exportStory(storyId: string, resultColumn: string, runId?: string): Promise<{ buffer: Buffer; filename: string }> {
  const story = get("stories", storyId);
  if (!story) throw new SheetError("Story not found");
  const cases = all("SELECT * FROM test_cases WHERE story_id=? ORDER BY sort, code", storyId);
  const imp = all("SELECT * FROM sheet_imports WHERE story_id=? ORDER BY created_at DESC LIMIT 1", storyId)[0];
  const results = latestResults(cases.map((c) => c.id), runId);
  const issues = all("SELECT * FROM issues WHERE result_id IN (SELECT id FROM results WHERE test_case_id IN (SELECT id FROM test_cases WHERE story_id=?)) ORDER BY created_at", storyId);

  const headers: string[] = imp ? [...(imp.headers as string[])] : [...DEFAULT_HEADERS, resultColumn, "Remarks"];
  const codeIdx: number | null = imp ? (imp.mapping as ColumnMapping).code : 0;
  // Remarks column: the one mapped at import, else the last remark-like header that is not the ID column.
  let remarksIdx: number = imp && (imp.mapping as ColumnMapping).remarks != null ? (imp.mapping as ColumnMapping).remarks! : -1;
  if (remarksIdx < 0) remarksIdx = headers.reduce((found, h, i) => (i !== codeIdx && /remark|comment/i.test(h) ? i : found), -1);
  let resultIdx = headers.findIndex((h, i) => i !== codeIdx && h.trim().toLowerCase() === resultColumn.trim().toLowerCase());
  const insertedResult = resultIdx < 0;
  if (insertedResult) {
    resultIdx = remarksIdx >= 0 ? remarksIdx : headers.length;
    headers.splice(resultIdx, 0, resultColumn);
    if (remarksIdx >= resultIdx) remarksIdx++;
  }
  if (remarksIdx < 0) remarksIdx = headers.push("Remarks") - 1;

  const wb = new ExcelJS.Workbook();
  wb.creator = "QA Pilot";
  const ws = wb.addWorksheet((imp?.sheet_name || story.title).slice(0, 31).replace(/[\\/?*[\]:]/g, "-"));
  styleHeader(ws.addRow(headers));

  for (const tc of cases) {
    let cells: string[];
    if (tc.sheet_row && imp && tc.import_id === imp.id) {
      cells = [...(tc.sheet_row as string[])];
      while (cells.length < (imp.headers as string[]).length) cells.push("");
      if (insertedResult) cells.splice(resultIdx, 0, "");
    } else {
      cells = headers.map(() => "");
      const set = (re: RegExp, v: string) => {
        const i = headers.findIndex((h) => re.test(h));
        if (i >= 0) cells[i] = v;
      };
      set(/test\s*case\s*no|^id$/i, tc.code);
      set(/scenario|title/i, tc.title);
      set(/pre-?condition/i, tc.preconditions);
      set(/step/i, (tc.steps as string[]).map((s, i) => `${i + 1}. ${s}`).join("\n"));
      set(/test\s*input|test\s*data/i, tc.test_data);
      set(/expected/i, tc.expected_result);
      set(/test\s*type/i, tc.type);
      set(/^qa$/i, tc.owner ?? "");
    }
    while (cells.length < headers.length) cells.push("");
    const res = results.get(tc.id);
    if (res) {
      cells[resultIdx] = STATUS_LABEL[res.status] ?? res.status;
      // Screen-level front-end findings (they carry a fingerprint) live on the Defects tab, not against one test case.
      const defects = issues.filter((i) => i.result_id === res.id && i.status !== "rejected" && !i.fingerprint);
      const notes = [
        ...defects.map((d) => `BUG${d.jira_key ? ` ${d.jira_key}` : ""}: ${d.title}`),
        ...(res.status === "blocked" || res.status === "error" ? [`Blocked: ${res.summary ?? ""}`] : []),
        ...((res.checks as Row[]) ?? []).filter((c) => c.status === "not_run").map((c) => `Not verified ${c.id}: ${c.reason ?? ""}`),
      ];
      const prior = cells[remarksIdx];
      cells[remarksIdx] = [prior, ...notes].filter(Boolean).join("\n");
    }
    const row = ws.addRow(cells);
    row.alignment = { vertical: "top", wrapText: true };
    colorStatus(row.getCell(resultIdx + 1));
  }
  headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...cases.map(() => 0));
    ws.getColumn(i + 1).width = /step|expected|scenario|remark|input|pre-?condition/i.test(h) ? 48 : Math.min(Math.max(longest + 4, 12), 24);
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  // Defects sheet
  const ds = wb.addWorksheet("Defects");
  styleHeader(ds.addRow(["Test Case", "Category", "Severity", "Title", "Expected", "Actual", "Comment", "Status", "Jira"]));
  for (const i of issues) {
    const r = ds.addRow([i.test_case_code ?? "", i.category, i.severity, i.title, i.expected, i.actual, [i.ai_comment, i.reviewer_comment].filter(Boolean).join("\n"), i.status, i.jira_key ?? ""]);
    r.alignment = { vertical: "top", wrapText: true };
  }
  [12, 12, 10, 40, 40, 40, 50, 10, 12].forEach((w, i) => (ds.getColumn(i + 1).width = w));
  ds.views = [{ state: "frozen", ySplit: 1 }];

  // Requirements coverage sheet
  const reqs = (story.requirements as Row[]) ?? [];
  if (reqs.length) {
    const rs = wb.addWorksheet("Coverage");
    styleHeader(rs.addRow(["Requirement", "Section", "Rule", "Covered by", "Result"]));
    for (const req of reqs) {
      const covering = cases.filter((c) => (c.requirement_ids as string[]).includes(req.id));
      const statuses = covering.map((c) => results.get(c.id)?.status).filter(Boolean) as string[];
      const verdict = !covering.length ? "NOT COVERED" : statuses.includes("failed") ? "Fail" : statuses.length && statuses.every((s) => s === "passed" || s === "flaky") ? "Pass" : statuses.length ? "Partial" : "Not run";
      const r = rs.addRow([req.id, req.section, req.text, covering.map((c) => c.code).join(", "), verdict]);
      r.alignment = { vertical: "top", wrapText: true };
      colorStatus(r.getCell(5));
    }
    [12, 20, 70, 24, 14].forEach((w, i) => (rs.getColumn(i + 1).width = w));
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const safe = story.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 50) || "test-cases";
  return { buffer, filename: `${safe} - ${resultColumn}.xlsx` };
}
