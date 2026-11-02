export interface Variable {
  key: string;
  value: string;
  secret: boolean;
  has_value?: boolean;
}

export interface Project {
  id: string;
  name: string;
  site_url: string;
  git_url: string | null;
  git_branch: string | null;
  login_url: string | null;
  username: string | null;
  login_notes: string | null;
  jira_project_key: string | null;
  default_device: string;
  app_context: string | null;
  app_context_updated_at: string | null;
  variables: Variable[];
  has_password: boolean;
  has_git_token: boolean;
  created_at: string;
  stories?: number;
  test_cases?: number;
  open_issues?: number;
  specs?: number;
}

export interface Requirement {
  id: string;
  section: string;
  text: string;
  kind: string;
  priority: "high" | "medium" | "low";
}

export interface ReviewFinding {
  kind: "contradiction" | "ambiguity" | "gap" | "typo" | "risk";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  quote: string;
  suggestion: string;
}

export interface Story {
  id: string;
  project_id: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  jira_key: string | null;
  requirements: Requirement[];
  review: ReviewFinding[];
  analyzed_at: string | null;
  created_at: string;
  test_case_count: number;
  coverage: { id: string; test_cases: string[] }[];
  sheet: { result_columns: string[]; source: string; sheet_name: string | null } | null;
}

export interface Check {
  id: string;
  text: string;
  requirement_ids: string[];
}

export interface TestCase {
  id: string;
  story_id: string | null;
  code: string;
  title: string;
  type: string;
  priority: string;
  preconditions: string;
  requires_login: boolean;
  steps: string[];
  test_data: string;
  expected_result: string;
  owner: string | null;
  checks: Check[];
  requirement_ids: string[];
  automation: "auto" | "partial" | "manual";
  source: "ai" | "manual";
  enabled: boolean;
  last_result?: { status: string; id: string; run_id: string } | null;
  spec?: { status: string; id: string } | null;
}

export interface Build {
  id: string;
  version: string;
  branch: string | null;
  commit_sha: string | null;
  site_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RunSummary {
  verdict: "ready" | "ready_with_risks" | "not_ready";
  headline: string;
  highlights: string[];
  risks: string[];
}

export interface Run {
  id: string;
  project_id: string;
  project_name?: string;
  build_id: string | null;
  build_version: string | null;
  name: string;
  device: string;
  status: "queued" | "running" | "completed" | "cancelled" | "error";
  error: string | null;
  ai_summary: RunSummary | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  counts: Record<string, number>;
  issue_counts: Record<string, number>;
  total: number;
}

export interface ExecutedStep {
  n: number;
  at: string;
  thought: string;
  testStep: number;
  action: { type: string; ref: number | null; value: string | null; description: string };
  locator: string | null;
  ok: boolean;
  result: string;
  verification: { check_id: string | null; expectation: string; passed: boolean; observation: string } | null;
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

export interface Result {
  id: string;
  run_id: string;
  test_case_id: string | null;
  test_case: Pick<TestCase, "code" | "title" | "type" | "priority" | "preconditions" | "requires_login" | "steps" | "test_data" | "expected_result" | "checks">;
  status: string;
  summary: string | null;
  steps: ExecutedStep[];
  checks: CheckResult[];
  trace_url: string | null;
  video_url: string | null;
  duration_ms: number | null;
}

export type IssueCategory = "functional" | "validation" | "content" | "navigation" | "frontend" | "accessibility";

export interface Issue {
  id: string;
  project_id: string;
  run_id: string | null;
  result_id: string | null;
  test_case_code: string | null;
  category: IssueCategory;
  check_id: string | null;
  requirement_ids: string[];
  title: string;
  description: string;
  steps_to_reproduce: string[];
  expected: string;
  actual: string;
  severity: "critical" | "major" | "minor" | "trivial";
  ai_comment: string;
  reviewer_comment: string;
  page_url: string | null;
  console_errors: string[];
  screenshot_url: string | null;
  annotated_url: string | null;
  status: "draft" | "approved" | "rejected" | "sent";
  issue_type: string;
  priority: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  jira_project_key: string | null;
  jira_key: string | null;
  jira_url: string | null;
  jira_error: string | null;
  created_at: string;
}

export interface Spec {
  id: string;
  project_id: string;
  test_case_id: string | null;
  result_id: string | null;
  file: string;
  code: string;
  status: "draft" | "passing" | "failing" | "broken";
  last_error: string | null;
  updated_at: string;
  tc_code?: string;
  title?: string;
  story_id?: string;
  story_title?: string;
}

export interface SuiteRun {
  id: string;
  project_id: string;
  status: "running" | "passed" | "failed" | "error";
  device: string;
  spec_ids: string[];
  summary: { stats: { expected: number; unexpected: number; skipped: number; flaky: number; duration: number } | null; files: Record<string, string>; hasReport: boolean } | null;
  log: string;
  report_url: string;
  created_at: string;
  finished_at: string | null;
}

export interface Settings {
  ai: { provider: "api" | "claude-code"; model: string; claudePath: string; detectedClaudePath: string | null; hasApiKey: boolean };
  jira: { type: "cloud" | "server"; baseUrl: string; email: string; hasToken: boolean };
  runner: { headless: boolean; video: boolean; trace: boolean; maxSteps: number; confirmFailures: boolean; frontendReview: boolean; maxVisualReviews: number };
  mailbox: { host: string; port: number; secure: boolean; user: string; hasPassword: boolean };
  webhookToken: string;
}
