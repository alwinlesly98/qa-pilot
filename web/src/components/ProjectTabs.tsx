import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, BookOpen, Bug, Check, ExternalLink, Package, PlayCircle, Plus, Send, Sparkles, Trash2, Webhook, X } from "lucide-react";
import { api } from "../lib/api";
import type { Build, Issue, IssueCategory, Project, Run, Settings, Story } from "../lib/types";
import { Badge, Empty, Field, Modal, Segmented, Spinner, timeAgo, useAction } from "./ui";
import { RunProgress } from "../pages/Dashboard";

// ---------------------------------------------------------------- stories

export function coveragePct(story: Story) {
  if (!story.coverage.length) return null;
  return Math.round((story.coverage.filter((c) => c.test_cases.length).length / story.coverage.length) * 100);
}

export function StoriesList({ project }: { project: Project }) {
  const navigate = useNavigate();
  const [stories, setStories] = useState<Story[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", acceptance_criteria: "", jira_key: "" });
  const { busy, run } = useAction();
  useEffect(() => void api.get<Story[]>(`/projects/${project.id}/stories`).then(setStories), [project.id]);

  const create = () =>
    run("create", async () => {
      const s = await api.post<Story>(`/projects/${project.id}/stories`, form);
      navigate(`/projects/${project.id}/stories/${s.id}?analyze=1`);
    });

  if (!stories) return <Spinner className="h-6 w-6 text-slate-400" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Each user story has its requirements, its test cases (AI-written or imported from your sheet) and its runs.</p>
        <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New user story</button>
      </div>
      {!stories.length ? (
        <Empty icon={<BookOpen className="h-6 w-6" />} title="Add your first user story" action={<button className="btn-primary" onClick={() => setOpen(true)}>Paste a story</button>}>
          Paste the story exactly as the team wrote it — Claude extracts every testable rule and flags gaps or contradictions.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {stories.map((s) => {
            const pct = coveragePct(s);
            const high = s.review.filter((r) => r.severity === "high").length;
            return (
              <Link key={s.id} to={`/projects/${project.id}/stories/${s.id}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 font-semibold text-slate-900 group-hover:text-brand-700">{s.title}</h3>
                  {s.jira_key && <Badge tone="blue">{s.jira_key}</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{s.description}</p>
                <div className="mt-auto pt-5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{s.requirements.length ? `${s.requirements.length} requirements` : "Not analysed yet"}</span>
                    <span className="tabular-nums">{pct == null ? "" : `${pct}% covered`}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${pct == null ? "" : pct === 100 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${pct ?? 0}%` }} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone="indigo">{s.test_case_count} test cases</Badge>
                    {s.review.length > 0 && <Badge tone={high ? "red" : "amber"}><AlertTriangle className="h-3 w-3" />{s.review.length} story issues</Badge>}
                    {s.sheet && <Badge tone="green">sheet</Badge>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New user story" subtitle="Paste it as the team wrote it — bullet points, field lists, validation messages and emails included." size="lg">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Field label="Title"><input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Submission form — Unsigned item" /></Field>
            <Field label="Jira key"><input className="input" value={form.jira_key} onChange={(e) => setForm({ ...form, jira_key: e.target.value })} placeholder="VC-123" /></Field>
          </div>
          <Field label="Story">
            <textarea className="input min-h-[320px] font-mono text-[13px] leading-relaxed" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="As a user I should be able to…" />
          </Field>
          <Field label="Acceptance criteria (optional)">
            <textarea className="input min-h-[80px]" value={form.acceptance_criteria} onChange={(e) => setForm({ ...form, acceptance_criteria: e.target.value })} />
          </Field>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-slate-500"><Sparkles className="h-3.5 w-3.5 text-brand-500" /> Claude analyses the story right after you create it.</span>
            <button className="btn-primary" disabled={!form.title || !form.description || busy === "create"} onClick={create}>{busy === "create" && <Spinner />}Create & analyse</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- builds

export function BuildsTab({ project, onRun }: { project: Project; onRun: () => void }) {
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [form, setForm] = useState({ version: "", branch: project.git_branch ?? "", commit_sha: "", site_url: "", notes: "", created_by: "" });
  const { busy, run } = useAction();
  const load = useCallback(() => api.get<Build[]>(`/projects/${project.id}/builds`).then(setBuilds), [project.id]);
  useEffect(() => {
    load();
    api.get<Settings>("/settings").then((s) => setToken(s.webhookToken));
  }, [load]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const curl = `curl -X POST ${location.origin.replace(":5173", ":4300")}/api/hooks/build \\
  -H "Content-Type: application/json" -H "X-QA-Token: ${token}" \\
  -d '{"projectId":"${project.id}","version":"1.4.0","branch":"main","commit":"$GIT_SHA","siteUrl":"https://staging.example.com","run":true,"analyze":true}'`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">A build is what the developer hands over: version, branch/commit and the URL where it is deployed.</p>
        <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Register build</button>
      </div>
      {!builds ? <Spinner /> : !builds.length ? (
        <Empty icon={<Package className="h-6 w-6" />} title="No builds yet">Register a build manually or let CI post it automatically with the webhook below.</Empty>
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden">
          {builds.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500"><Package className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900">{b.version} {b.branch && <span className="ml-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{b.branch}</span>} {b.commit_sha && <span className="font-mono text-xs text-slate-400">{b.commit_sha.slice(0, 8)}</span>}</div>
                <div className="truncate text-xs text-slate-500">{b.site_url || project.site_url} · {b.created_by ? `${b.created_by} · ` : ""}{timeAgo(b.created_at)}</div>
                {b.notes && <div className="mt-1 text-sm text-slate-600">{b.notes}</div>}
              </div>
              <button className="btn-ghost text-red-600" onClick={() => run("del", async () => { await api.del(`/builds/${b.id}`); load(); })}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
      {builds && builds.length > 0 && <button className="btn-secondary" onClick={onRun}><PlayCircle className="h-4 w-4" /> Test the latest build</button>}

      <div className="card p-6">
        <h3 className="flex items-center gap-2 font-semibold"><Webhook className="h-4 w-4 text-brand-600" /> CI / CD webhook</h3>
        <p className="mt-1 text-sm text-slate-500">Add this step to your pipeline after deploy. It registers the build, refreshes the code analysis and starts a full run.</p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-100">{curl}</pre>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Register a build">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Version"><input className="input" value={form.version} onChange={set("version")} placeholder="1.4.0-rc2" autoFocus /></Field>
          <Field label="Developer"><input className="input" value={form.created_by} onChange={set("created_by")} /></Field>
          <Field label="Branch"><input className="input" value={form.branch} onChange={set("branch")} /></Field>
          <Field label="Commit"><input className="input font-mono" value={form.commit_sha} onChange={set("commit_sha")} /></Field>
          <Field className="sm:col-span-2" label="Deployed URL" hint="Leave empty to use the project site URL."><input className="input" value={form.site_url} onChange={set("site_url")} placeholder={project.site_url} /></Field>
          <Field className="sm:col-span-2" label="Release notes"><textarea className="input min-h-[80px]" value={form.notes} onChange={set("notes")} /></Field>
        </div>
        <div className="mt-5 flex justify-end">
          <button className="btn-primary" disabled={!form.version || busy === "add"} onClick={() => run("add", async () => { await api.post(`/projects/${project.id}/builds`, form); setOpen(false); load(); }, "Build registered")}>
            {busy === "add" && <Spinner />} Save build
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- runs

export function RunsList({ projectId, storyId, onRun }: { projectId: string; storyId?: string; onRun: () => void }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    const load = () => api.get<Run[]>(`/projects/${projectId}/runs${storyId ? `?storyId=${storyId}` : ""}`).then(setRuns);
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [projectId, storyId]);
  if (!runs) return <Spinner />;
  if (!runs.length)
    return (
      <Empty icon={<PlayCircle className="h-6 w-6" />} title="No runs yet" action={<button className="btn-primary" onClick={onRun}>Start the first run</button>}>
        Claude drives a real browser through every test case and records evidence for each check.
      </Empty>
    );
  return (
    <div className="card divide-y divide-slate-100 overflow-hidden">
      {runs.map((r) => {
        const fe = (r.issue_counts.frontend ?? 0) + (r.issue_counts.accessibility ?? 0) + (r.issue_counts.content ?? 0);
        return (
          <Link key={r.id} to={`/runs/${r.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">{r.name}</div>
              <div className="text-xs text-slate-500">{r.device} · {timeAgo(r.created_at)}</div>
              <div className="mt-1.5 max-w-md"><RunProgress run={r} /></div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge tone="green">{r.counts.passed ?? 0} passed</Badge>
              {(r.counts.failed ?? 0) > 0 && <Badge tone="red">{r.counts.failed} failed</Badge>}
              {(r.counts.blocked ?? 0) > 0 && <Badge tone="amber">{r.counts.blocked} blocked</Badge>}
              {fe > 0 && <Badge tone="cyan">{fe} UI/content</Badge>}
            </div>
            <Badge value={r.status} />
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- issues

const STATUS_FILTERS = ["draft", "approved", "sent", "rejected", "all"] as const;
export const CATEGORY_LABEL: Record<IssueCategory | "all", string> = {
  all: "All", functional: "Functional", validation: "Validation", navigation: "Navigation", content: "Content", frontend: "Front-end", accessibility: "Accessibility",
};

export function IssueCard({ issue: i, selected, onSelect }: { issue: Issue; selected?: boolean; onSelect?: (on: boolean) => void }) {
  return (
    <div className={`card flex gap-4 p-3 transition hover:border-brand-200 ${selected ? "ring-2 ring-brand-500" : ""}`}>
      {onSelect && <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={!!selected} onChange={(e) => onSelect(e.target.checked)} disabled={i.status === "sent"} />}
      <Link to={`/issues/${i.id}`} className="flex min-w-0 flex-1 gap-4">
        <div className="h-20 w-32 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
          {(i.annotated_url || i.screenshot_url) && <img src={i.annotated_url || i.screenshot_url!} className="h-full w-full object-cover object-top" alt="" loading="lazy" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge value={i.category}>{CATEGORY_LABEL[i.category] ?? i.category}</Badge>
            <Badge value={i.severity} />
            <Badge value={i.status} />
            {i.test_case_code && <span className="font-mono text-xs text-slate-400">{i.test_case_code}{i.check_id ? ` · ${i.check_id}` : ""}</span>}
            {i.jira_key && <span className="flex items-center gap-1 text-xs font-semibold text-blue-700">{i.jira_key}<ExternalLink className="h-3 w-3" /></span>}
          </div>
          <div className="mt-1 truncate font-medium text-slate-900">{i.title}</div>
          <div className="truncate text-sm text-slate-500">{i.actual}</div>
          <div className="mt-1 text-xs text-slate-400">{i.assignee_name ? `Assignee: ${i.assignee_name} · ` : ""}{timeAgo(i.created_at)}</div>
        </div>
      </Link>
    </div>
  );
}

export function IssuesTab({ project }: { project: Project }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("draft");
  const [category, setCategory] = useState<IssueCategory | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { busy, run } = useAction();
  const load = useCallback(() => api.get<Issue[]>(`/projects/${project.id}/issues`).then(setIssues), [project.id]);
  useEffect(() => void load(), [load]);
  if (!issues) return <Spinner />;
  const byStatus = status === "all" ? issues : issues.filter((i) => i.status === status);
  const shown = category === "all" ? byStatus : byStatus.filter((i) => i.category === category);
  const approved = issues.filter((i) => i.status === "approved").length;
  const cats = (Object.keys(CATEGORY_LABEL) as (IssueCategory | "all")[]).filter((c) => c === "all" || byStatus.some((i) => i.category === c));

  const bulk = (to: "approved" | "rejected") =>
    run("bulk", async () => {
      await api.post("/issues/bulk", { ids: [...selected], status: to });
      setSelected(new Set());
      await load();
    }, to === "approved" ? "Approved" : "Marked as not a bug");

  const sendAll = () =>
    run("send", async () => {
      const r = await api.post<{ sent: number; failed: { error: string }[] }>("/issues/send-approved", { projectId: project.id });
      await load();
      if (r.failed.length) throw new Error(`${r.sent} sent, ${r.failed.length} failed: ${r.failed[0].error}`);
      return r;
    }, "Approved issues sent to Jira");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented options={STATUS_FILTERS.map((f) => ({ key: f, label: f === "rejected" ? "Not a bug" : f[0].toUpperCase() + f.slice(1), count: f === "all" ? issues.length : issues.filter((i) => i.status === f).length }))} value={status} onChange={(v) => { setStatus(v); setSelected(new Set()); }} />
        <div className="flex flex-wrap gap-2">
          {selected.size > 0 && (
            <>
              <button className="btn-secondary" disabled={!!busy} onClick={() => bulk("rejected")}><X className="h-4 w-4" /> Not a bug ({selected.size})</button>
              <button className="btn-secondary" disabled={!!busy} onClick={() => bulk("approved")}><Check className="h-4 w-4" /> Approve ({selected.size})</button>
            </>
          )}
          <button className="btn-primary" disabled={!approved || busy === "send"} onClick={sendAll}>
            {busy === "send" ? <Spinner /> : <Send className="h-4 w-4" />} Send {approved} approved to Jira
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <button key={c} onClick={() => setCategory(c)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${category === c ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
            {CATEGORY_LABEL[c]} <span className="tabular-nums text-slate-400">{c === "all" ? byStatus.length : byStatus.filter((i) => i.category === c).length}</span>
          </button>
        ))}
      </div>
      {!shown.length ? (
        <Empty icon={<Bug className="h-6 w-6" />} title="Nothing here">Defects and front-end findings from test runs appear here as drafts for review.</Empty>
      ) : (
        <div className="grid gap-3">
          {shown.map((i) => (
            <IssueCard key={i.id} issue={i} selected={selected.has(i.id)} onSelect={(on) => { const n = new Set(selected); if (on) n.add(i.id); else n.delete(i.id); setSelected(n); }} />
          ))}
        </div>
      )}
    </div>
  );
}
