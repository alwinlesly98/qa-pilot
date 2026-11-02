import Database from "better-sqlite3";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./config";

export const db = new Database(path.join(DATA_DIR, "qa-pilot.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  git_url TEXT,
  git_branch TEXT,
  git_token_enc TEXT,
  login_url TEXT,
  username TEXT,
  password_enc TEXT,
  login_notes TEXT,
  jira_project_key TEXT,
  default_device TEXT NOT NULL DEFAULT 'Desktop Chrome',
  app_context TEXT,
  app_context_updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  jira_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_cases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_id TEXT REFERENCES stories(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'positive',
  priority TEXT NOT NULL DEFAULT 'medium',
  preconditions TEXT NOT NULL DEFAULT '',
  requires_login INTEGER NOT NULL DEFAULT 1,
  steps TEXT NOT NULL DEFAULT '[]',
  expected_result TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'ai',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  branch TEXT,
  commit_sha TEXT,
  site_url TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT REFERENCES builds(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  device TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  ai_summary TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  test_case_id TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
  test_case TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  summary TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  trace_path TEXT,
  video_path TEXT,
  duration_ms INTEGER,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  result_id TEXT REFERENCES results(id) ON DELETE CASCADE,
  test_case_code TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  steps_to_reproduce TEXT NOT NULL DEFAULT '[]',
  expected TEXT NOT NULL DEFAULT '',
  actual TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'major',
  ai_comment TEXT NOT NULL DEFAULT '',
  reviewer_comment TEXT NOT NULL DEFAULT '',
  page_url TEXT,
  console_errors TEXT NOT NULL DEFAULT '[]',
  screenshot_path TEXT,
  annotated_path TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  issue_type TEXT NOT NULL DEFAULT 'Bug',
  priority TEXT,
  assignee_id TEXT,
  assignee_name TEXT,
  jira_project_key TEXT,
  jira_key TEXT,
  jira_url TEXT,
  jira_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tc_project ON test_cases(project_id);
CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);

-- A spreadsheet the team's test cases came from; kept so results can be exported in the same layout.
CREATE TABLE IF NOT EXISTS sheet_imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_id TEXT REFERENCES stories(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  sheet_name TEXT,
  headers TEXT NOT NULL DEFAULT '[]',
  mapping TEXT NOT NULL DEFAULT '{}',
  result_columns TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

-- Generated Playwright spec files (the regression suite).
CREATE TABLE IF NOT EXISTS specs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_case_id TEXT REFERENCES test_cases(id) ON DELETE CASCADE,
  result_id TEXT REFERENCES results(id) ON DELETE SET NULL,
  file TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suite_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  device TEXT,
  spec_ids TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  log TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  finished_at TEXT
);
`);

/** Add columns introduced after the first release (SQLite has no ADD COLUMN IF NOT EXISTS). */
function ensureColumns(table: string, columns: Record<string, string>) {
  const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const [name, def] of Object.entries(columns)) if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
}
ensureColumns("projects", { variables: "TEXT NOT NULL DEFAULT '[]'" });
ensureColumns("stories", { requirements: "TEXT NOT NULL DEFAULT '[]'", review: "TEXT NOT NULL DEFAULT '[]'", analyzed_at: "TEXT" });
ensureColumns("test_cases", {
  test_data: "TEXT NOT NULL DEFAULT ''",
  owner: "TEXT",
  checks: "TEXT NOT NULL DEFAULT '[]'",
  requirement_ids: "TEXT NOT NULL DEFAULT '[]'",
  automation: "TEXT NOT NULL DEFAULT 'auto'",
  import_id: "TEXT",
  sheet_row: "TEXT",
  sort: "INTEGER NOT NULL DEFAULT 0",
});
ensureColumns("results", { checks: "TEXT NOT NULL DEFAULT '[]'", frontend: "TEXT NOT NULL DEFAULT '[]'" });
ensureColumns("issues", { category: "TEXT NOT NULL DEFAULT 'functional'", check_id: "TEXT", requirement_ids: "TEXT NOT NULL DEFAULT '[]'", fingerprint: "TEXT" });

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

/** Columns that hold JSON text and are parsed on read / stringified on write. */
const JSON_COLUMNS = new Set([
  "steps", "test_case", "steps_to_reproduce", "console_errors", "variables", "requirements", "review", "checks",
  "requirement_ids", "sheet_row", "frontend", "headers", "mapping", "result_columns", "spec_ids",
]);
const BOOL_COLUMNS = new Set(["requires_login", "enabled"]);

export type Row = Record<string, any>;

function decode(row: Row | undefined): Row | undefined {
  if (!row) return row;
  for (const k of Object.keys(row)) {
    if (JSON_COLUMNS.has(k) && typeof row[k] === "string") row[k] = JSON.parse(row[k]);
    else if (BOOL_COLUMNS.has(k)) row[k] = !!row[k];
  }
  return row;
}

function encode(values: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    if (JSON_COLUMNS.has(k)) out[k] = JSON.stringify(v);
    else if (typeof v === "boolean") out[k] = v ? 1 : 0;
    else out[k] = v;
  }
  return out;
}

export function insert(table: string, values: Row): Row {
  const row = encode({ id: newId(), ...values });
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`).run(row);
  return get(table, row.id)!;
}

export function update(table: string, id: string, values: Row): Row | undefined {
  const row = encode(values);
  const cols = Object.keys(row);
  if (cols.length) db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c}=@${c}`).join(",")} WHERE id=@__id`).run({ ...row, __id: id });
  return get(table, id);
}

export function get(table: string, id: string): Row | undefined {
  return decode(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Row | undefined);
}

export function all(sql: string, ...params: unknown[]): Row[] {
  return (db.prepare(sql).all(...params) as Row[]).map((r) => decode(r)!);
}

export function remove(table: string, id: string) {
  db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(key: string, value: unknown) {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
}
