import fs from "node:fs";
import path from "node:path";
import { decrypt } from "../crypto";
import { now, Row, update } from "../db";
import { getSettings } from "../settings";

export class JiraError extends Error {}

function conn() {
  const { jira } = getSettings();
  const token = decrypt(jira.tokenEnc);
  if (!jira.baseUrl || !token) throw new JiraError("Jira is not configured. Add the URL and API token in Settings.");
  const cloud = jira.type === "cloud";
  const auth = cloud ? `Basic ${Buffer.from(`${jira.email}:${token}`).toString("base64")}` : `Bearer ${token}`;
  return { base: jira.baseUrl, api: cloud ? "/rest/api/3" : "/rest/api/2", cloud, auth };
}

async function call<T>(method: string, apiPath: string, body?: unknown, raw = false): Promise<T> {
  const c = conn();
  const res = await fetch(`${c.base}${raw ? "" : c.api}${apiPath}`, {
    method,
    headers: { Authorization: c.auth, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      msg = [...(j.errorMessages ?? []), ...Object.entries(j.errors ?? {}).map(([k, v]) => `${k}: ${v}`)].join("; ") || msg;
    } catch {}
    throw new JiraError(`Jira ${res.status}: ${msg}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function testJira() {
  const me = await call<{ displayName: string }>("GET", "/myself");
  return `Connected as ${me.displayName}`;
}

export async function listProjects() {
  const c = conn();
  if (c.cloud) {
    const r = await call<{ values: { key: string; name: string }[] }>("GET", "/project/search?maxResults=200&orderBy=name");
    return r.values.map((p) => ({ key: p.key, name: p.name }));
  }
  const r = await call<{ key: string; name: string }[]>("GET", "/project");
  return r.map((p) => ({ key: p.key, name: p.name }));
}

export async function searchUsers(projectKey: string, query: string) {
  const c = conn();
  const q = encodeURIComponent(query);
  const p = encodeURIComponent(projectKey);
  if (c.cloud) {
    const r = await call<{ accountId: string; displayName: string; emailAddress?: string; avatarUrls?: Record<string, string> }[]>(
      "GET", `/user/assignable/search?project=${p}&query=${q}&maxResults=25`,
    );
    return r.map((u) => ({ id: u.accountId, name: u.displayName, email: u.emailAddress ?? "", avatar: u.avatarUrls?.["24x24"] ?? null }));
  }
  const r = await call<{ name: string; displayName: string; emailAddress?: string }[]>("GET", `/user/assignable/search?project=${p}&username=${q}&maxResults=25`);
  return r.map((u) => ({ id: u.name, name: u.displayName, email: u.emailAddress ?? "", avatar: null }));
}

export async function issueTypes(projectKey: string) {
  const r = await call<{ issueTypes?: { name: string; subtask: boolean }[]; values?: { name: string; subtask: boolean }[] }>(
    "GET", `/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
  );
  return (r.issueTypes ?? r.values ?? []).filter((t) => !t.subtask).map((t) => t.name);
}

// ---------------------------------------------------------------- description builders

type Adf = Record<string, unknown>;
const text = (t: string, marks?: Adf[]): Adf => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (t: string): Adf => ({ type: "paragraph", content: t ? [text(t)] : [] });
const heading = (t: string): Adf => ({ type: "heading", attrs: { level: 3 }, content: [text(t)] });
const ordered = (items: string[]): Adf => ({ type: "orderedList", content: items.map((i) => ({ type: "listItem", content: [para(i)] })) });

function sections(issue: Row, testCaseLabel: string) {
  return {
    summary: issue.description as string,
    steps: (issue.steps_to_reproduce as string[]) ?? [],
    expected: issue.expected as string,
    actual: issue.actual as string,
    qaComment: [issue.ai_comment, issue.reviewer_comment].filter(Boolean).join("\n\n"),
    env: [
      `Page: ${issue.page_url ?? "-"}`,
      `Severity: ${issue.severity}`,
      `Category: ${issue.category ?? "functional"}`,
      issue.check_id ? `Check: ${issue.check_id}` : "",
      (issue.requirement_ids ?? []).length ? `Requirements: ${issue.requirement_ids.join(", ")}` : "",
      `Test case: ${testCaseLabel}`,
      `Reported by QA Pilot on ${new Date().toISOString().slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    errors: (issue.console_errors as string[]) ?? [],
  };
}

function adfDescription(issue: Row, tc: string): Adf {
  const s = sections(issue, tc);
  const content: Adf[] = [para(s.summary)];
  if (s.steps.length) content.push(heading("Steps to reproduce"), ordered(s.steps));
  content.push(heading("Expected result"), para(s.expected), heading("Actual result"), para(s.actual));
  if (s.qaComment) content.push(heading("QA comment"), ...s.qaComment.split(/\n{2,}/).map(para));
  content.push(heading("Environment"), ...s.env.split("\n").map(para));
  if (s.errors.length) content.push(heading("Console / network errors"), { type: "codeBlock", content: [text(s.errors.join("\n"))] });
  return { type: "doc", version: 1, content };
}

function wikiDescription(issue: Row, tc: string): string {
  const s = sections(issue, tc);
  return [
    s.summary,
    s.steps.length ? `h3. Steps to reproduce\n${s.steps.map((x) => `# ${x}`).join("\n")}` : "",
    `h3. Expected result\n${s.expected}`,
    `h3. Actual result\n${s.actual}`,
    s.qaComment ? `h3. QA comment\n${s.qaComment}` : "",
    `h3. Environment\n${s.env}`,
    s.errors.length ? `h3. Console / network errors\n{code}\n${s.errors.join("\n")}\n{code}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------- create

async function attach(issueKey: string, file: string) {
  const c = conn();
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  const res = await fetch(`${c.base}${c.api}/issue/${issueKey}/attachments`, {
    method: "POST",
    headers: { Authorization: c.auth, "X-Atlassian-Token": "no-check" },
    body: form,
  });
  if (!res.ok) throw new JiraError(`Attachment upload failed (${res.status})`);
}

export async function sendIssueToJira(issue: Row): Promise<Row> {
  const c = conn();
  const projectKey = issue.jira_project_key;
  if (!projectKey) throw new JiraError("Choose a Jira project for this issue.");
  const tc = issue.test_case_code ?? "-";
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: issue.title.slice(0, 250),
    issuetype: { name: issue.issue_type || "Bug" },
    description: c.cloud ? adfDescription(issue, tc) : wikiDescription(issue, tc),
    labels: ["qa-pilot", `severity-${issue.severity}`, `qa-${issue.category ?? "functional"}`],
  };
  if (issue.assignee_id) fields.assignee = c.cloud ? { accountId: issue.assignee_id } : { name: issue.assignee_id };
  if (issue.priority) fields.priority = { name: issue.priority };

  let created: { key: string };
  try {
    created = await call("POST", "/issue", { fields });
  } catch (e) {
    // Some projects hide the priority field on the create screen; retry without it.
    if (fields.priority && /priority/i.test((e as Error).message)) {
      delete fields.priority;
      created = await call("POST", "/issue", { fields });
    } else throw e;
  }

  const shots = [issue.annotated_path, issue.screenshot_path].filter((p): p is string => !!p && fs.existsSync(p));
  for (const file of shots) await attach(created.key, file).catch(() => {});

  return update("issues", issue.id, {
    status: "sent",
    jira_key: created.key,
    jira_url: `${c.base}/browse/${created.key}`,
    jira_error: null,
    updated_at: now(),
  })!;
}
