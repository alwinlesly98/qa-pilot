import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bot, Check, ExternalLink, Save, Send, Trash2, UserRound, X } from "lucide-react";
import { api } from "../lib/api";
import type { Issue, Project } from "../lib/types";
import Annotator from "../components/Annotator";
import { CATEGORY_LABEL } from "../components/ProjectTabs";
import { Badge, Field, Spinner, useAction, useToast } from "../components/ui";

interface JiraUser { id: string; name: string; email: string; avatar: string | null }

function AssigneePicker({ projectKey, value, onChange }: { projectKey: string | null; value: { id: string | null; name: string | null }; onChange: (u: { id: string | null; name: string | null }) => void }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!open || !projectKey) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.get<JiraUser[]>(`/jira/users?project=${encodeURIComponent(projectKey)}&query=${encodeURIComponent(q)}`)
        .then((u) => { setUsers(u); setError(null); })
        .catch((e) => setError(e.message));
    }, 250);
  }, [q, open, projectKey]);

  if (value.id && !open)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        <UserRound className="h-4 w-4 text-slate-400" /> <span className="flex-1">{value.name}</span>
        <button className="text-slate-400 hover:text-slate-700" onClick={() => onChange({ id: null, name: null })}><X className="h-4 w-4" /></button>
      </div>
    );
  return (
    <div className="relative">
      <input className="input" disabled={!projectKey} placeholder={projectKey ? "Search Jira users…" : "Choose a Jira project first"} value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} />
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {error && <div className="px-3 py-2 text-xs text-red-600">{error}</div>}
          {users.map((u) => (
            <button key={u.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onMouseDown={() => { onChange({ id: u.id, name: u.name }); setOpen(false); }}>
              {u.avatar ? <img src={u.avatar} className="h-5 w-5 rounded-full" alt="" /> : <UserRound className="h-5 w-5 text-slate-400" />}
              <span>{u.name}</span><span className="truncate text-xs text-slate-400">{u.email}</span>
            </button>
          ))}
          {!error && !users.length && <div className="px-3 py-2 text-xs text-slate-500">No assignable users found</div>}
        </div>
      )}
    </div>
  );
}

export default function IssueEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [draft, setDraft] = useState<Issue | null>(null);
  const [jiraProjects, setJiraProjects] = useState<{ key: string; name: string }[]>([]);
  const [types, setTypes] = useState<string[]>(["Bug", "Task", "Story"]);
  const { busy, run } = useAction();

  useEffect(() => {
    api.get<Issue>(`/issues/${id}`).then(async (i) => {
      if (!i.jira_project_key) {
        const p = await api.get<Project>(`/projects/${i.project_id}`);
        i.jira_project_key = p.jira_project_key;
      }
      setIssue(i);
      setDraft(i);
    });
    api.get<{ key: string; name: string }[]>("/jira/projects").then(setJiraProjects).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (draft?.jira_project_key) api.get<string[]>(`/jira/issuetypes?project=${draft.jira_project_key}`).then((t) => t.length && setTypes(t)).catch(() => {});
  }, [draft?.jira_project_key]);

  if (!issue || !draft) return <Spinner className="h-6 w-6 text-slate-400" />;
  const set = <K extends keyof Issue>(k: K, v: Issue[K]) => setDraft({ ...draft, [k]: v });
  const dirty = JSON.stringify(draft) !== JSON.stringify(issue);

  const save = (extra: Partial<Issue> = {}, msg = "Saved") =>
    run("save", async () => {
      const updated = await api.put<Issue>(`/issues/${issue.id}`, { ...draft, ...extra });
      setIssue(updated);
      setDraft(updated);
    }, msg);

  const send = () =>
    run("send", async () => {
      if (dirty) await api.put(`/issues/${issue.id}`, draft);
      const updated = await api.post<Issue>(`/issues/${issue.id}/jira`);
      setIssue(updated);
      setDraft(updated);
      return updated;
    }, "Created in Jira");

  const sent = issue.status === "sent";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to={`/projects/${issue.project_id}?tab=issues`} className="text-sm text-slate-500 hover:text-brand-600">← Issues</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge value={issue.status} /><Badge value={issue.category}>{CATEGORY_LABEL[issue.category] ?? issue.category}</Badge><Badge value={issue.severity} />
            {issue.test_case_code && <span className="font-mono text-xs text-slate-400">{issue.test_case_code}{issue.check_id ? ` · ${issue.check_id}` : ""}</span>}
            {issue.requirement_ids.map((r) => <span key={r} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{r}</span>)}
            {issue.run_id && <Link to={`/runs/${issue.run_id}`} className="text-xs text-brand-600 hover:underline">open run</Link>}
            {issue.jira_key && <a href={issue.jira_url!} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-semibold text-blue-700">{issue.jira_key} <ExternalLink className="h-3.5 w-3.5" /></a>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost text-red-600" onClick={() => confirm("Delete this issue?") && run("del", async () => { await api.del(`/issues/${issue.id}`); navigate(`/projects/${issue.project_id}?tab=issues`); })}><Trash2 className="h-4 w-4" /></button>
          {!sent && <button className="btn-secondary" disabled={!!busy} onClick={() => save({ status: "rejected" }, "Marked as not a bug")}><X className="h-4 w-4" /> Not a bug</button>}
          <button className="btn-secondary" disabled={!dirty || !!busy} onClick={() => save()}><Save className="h-4 w-4" /> Save</button>
          {!sent && <button className="btn-secondary" disabled={!!busy} onClick={() => save({ status: "approved" }, "Approved - will be sent with the next batch")}><Check className="h-4 w-4" /> Approve</button>}
          {!sent && <button className="btn-primary" disabled={!!busy || !draft.jira_project_key} onClick={send}>{busy === "send" ? <Spinner /> : <Send className="h-4 w-4" />} Send to Jira</button>}
        </div>
      </div>
      {issue.jira_error && !sent && <div className="card border-red-200 bg-red-50 p-3 text-sm text-red-700">Last Jira error: {issue.jira_error}</div>}

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-5">
          <div className="card p-4">
            {issue.screenshot_url ? (
              <Annotator
                src={issue.annotated_url || issue.screenshot_url}
                original={issue.screenshot_url}
                onSave={async (dataUrl) => {
                  try {
                    const updated = await api.post<Issue>(`/issues/${issue.id}/annotation`, { dataUrl });
                    setIssue(updated);
                    setDraft({ ...draft, annotated_url: updated.annotated_url });
                    toast("success", "Annotated screenshot saved - it will be attached to the Jira ticket");
                  } catch (e) {
                    toast("error", (e as Error).message);
                  }
                }}
              />
            ) : (
              <p className="text-sm text-slate-500">No screenshot captured.</p>
            )}
            {issue.page_url && <p className="mt-2 truncate font-mono text-xs text-slate-500">{issue.page_url}</p>}
          </div>

          <div className="card space-y-3 p-5">
            <Field label={<span className="flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" /> QA comment (written by Claude - edit as needed)</span>}>
              <textarea className="input min-h-[110px]" value={draft.ai_comment} onChange={(e) => set("ai_comment", e.target.value)} disabled={sent} />
            </Field>
            <Field label="Reviewer comment">
              <textarea className="input min-h-[80px]" value={draft.reviewer_comment} onChange={(e) => set("reviewer_comment", e.target.value)} placeholder="Your notes for the developer" disabled={sent} />
            </Field>
          </div>

          {issue.console_errors.length > 0 && (
            <div className="card p-5">
              <div className="label">Console / network errors</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-xs text-red-300">{issue.console_errors.join("\n")}</pre>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="card space-y-4 p-5">
            <Field label="Title"><input className="input font-medium" value={draft.title} onChange={(e) => set("title", e.target.value)} disabled={sent} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select className="input" value={draft.category} onChange={(e) => set("category", e.target.value as Issue["category"])} disabled={sent}>
                  {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).filter((c) => c !== "all").map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </select>
              </Field>
              <Field label="Severity">
                <select className="input" value={draft.severity} onChange={(e) => set("severity", e.target.value as Issue["severity"])} disabled={sent}>
                  {["critical", "major", "minor", "trivial"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Jira priority">
                <select className="input" value={draft.priority ?? ""} onChange={(e) => set("priority", e.target.value || null)} disabled={sent}>
                  <option value="">Project default</option>
                  {["Highest", "High", "Medium", "Low", "Lowest"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Jira project">
                {jiraProjects.length ? (
                  <select className="input" value={draft.jira_project_key ?? ""} onChange={(e) => setDraft({ ...draft, jira_project_key: e.target.value || null, assignee_id: null, assignee_name: null })} disabled={sent}>
                    <option value="">—</option>
                    {jiraProjects.map((p) => <option key={p.key} value={p.key}>{p.key} · {p.name}</option>)}
                  </select>
                ) : (
                  <input className="input" value={draft.jira_project_key ?? ""} onChange={(e) => set("jira_project_key", e.target.value)} disabled={sent} />
                )}
              </Field>
              <Field label="Issue type">
                <select className="input" value={draft.issue_type} onChange={(e) => set("issue_type", e.target.value)} disabled={sent}>
                  {[...new Set([draft.issue_type, ...types])].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Assignee">
              <AssigneePicker projectKey={draft.jira_project_key} value={{ id: draft.assignee_id, name: draft.assignee_name }} onChange={(u) => setDraft({ ...draft, assignee_id: u.id, assignee_name: u.name })} />
            </Field>
          </div>

          <div className="card space-y-4 p-5">
            <Field label="Description"><textarea className="input min-h-[70px]" value={draft.description} onChange={(e) => set("description", e.target.value)} disabled={sent} /></Field>
            <Field label="Steps to reproduce (one per line)">
              <textarea className="input min-h-[120px]" value={draft.steps_to_reproduce.join("\n")} onChange={(e) => set("steps_to_reproduce", e.target.value.split("\n"))} disabled={sent} />
            </Field>
            <Field label="Expected"><textarea className="input min-h-[60px]" value={draft.expected} onChange={(e) => set("expected", e.target.value)} disabled={sent} /></Field>
            <Field label="Actual"><textarea className="input min-h-[60px]" value={draft.actual} onChange={(e) => set("actual", e.target.value)} disabled={sent} /></Field>
          </div>
        </div>
      </div>
    </div>
  );
}
