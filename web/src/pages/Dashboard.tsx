import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Accessibility, ArrowRight, Bug, CheckCircle2, Code2, FileText, FlaskConical, FolderPlus, Gauge, Layout, PlayCircle, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import type { Project, Run } from "../lib/types";
import { Badge, Empty, PageHeader, Spinner, Stat, timeAgo } from "../components/ui";

export function RunProgress({ run }: { run: Pick<Run, "counts" | "total"> }) {
  const total = run.total || 1;
  const seg = (key: string, color: string) => {
    const n = run.counts[key] ?? 0;
    return n ? <div key={key} className={color} style={{ width: `${(n / total) * 100}%` }} title={`${key}: ${n}`} /> : null;
  };
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      {seg("passed", "bg-emerald-500")}
      {seg("flaky", "bg-purple-500")}
      {seg("failed", "bg-red-500")}
      {seg("blocked", "bg-amber-400")}
      {seg("error", "bg-slate-400")}
      {seg("running", "bg-blue-500 animate-pulse")}
    </div>
  );
}

interface DashboardData {
  projects: Project[];
  runs: Run[];
  totals: Record<string, number>;
  open_issues: Record<string, number>;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => {
    const load = () => api.get<DashboardData>("/dashboard").then(setData);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <Spinner className="h-6 w-6 text-slate-400" />;
  const executed = Object.values(data.totals).reduce((a, b) => a + b, 0);
  const passRate = executed ? Math.round((((data.totals.passed ?? 0) + (data.totals.flaky ?? 0)) / executed) * 100) : null;
  const openFunctional = (data.open_issues.functional ?? 0) + (data.open_issues.validation ?? 0) + (data.open_issues.navigation ?? 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        subtitle="User story → requirements → AI-executed test cases → Playwright suite → reviewed Jira bugs."
        actions={<Link to="/projects/new" className="btn-primary"><FolderPlus className="h-4 w-4" /> New project</Link>}
      />

      {!data.projects.length ? (
        <Empty icon={<Sparkles className="h-6 w-6" />} title="Create your first project" action={<Link to="/projects/new" className="btn-primary">Create project</Link>}>
          Add the site URL, login details and test data. Then paste a user story, import your test case sheet, and let Claude test it.
        </Empty>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Pass rate" value={passRate == null ? "—" : `${passRate}%`} tone={passRate == null ? "slate" : passRate >= 90 ? "green" : passRate >= 70 ? "amber" : "red"} icon={<Gauge className="h-4 w-4" />} hint={`${executed} executions`} />
            <Stat label="Functional bugs" value={openFunctional} tone={openFunctional ? "red" : "slate"} icon={<Bug className="h-4 w-4" />} hint="open, to review" />
            <Stat label="Content mismatches" value={data.open_issues.content ?? 0} tone="purple" icon={<FileText className="h-4 w-4" />} hint="copy differs from story" />
            <Stat label="Front-end issues" value={data.open_issues.frontend ?? 0} tone="cyan" icon={<Layout className="h-4 w-4" />} hint="layout / visual" />
            <Stat label="Accessibility" value={data.open_issues.accessibility ?? 0} tone="pink" icon={<Accessibility className="h-4 w-4" />} hint="WCAG 2.2 AA" />
          </div>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Projects</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.projects.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="card group p-5 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-slate-900 group-hover:text-brand-700">{p.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{p.site_url}</p>
                    </div>
                    {p.jira_project_key && <Badge tone="blue">{p.jira_project_key}</Badge>}
                  </div>
                  <div className="mt-5 grid grid-cols-4 gap-2 text-center">
                    {[
                      [p.stories, "stories", <FileText key="s" className="h-3.5 w-3.5" />],
                      [p.test_cases, "tests", <FlaskConical key="t" className="h-3.5 w-3.5" />],
                      [p.specs, "specs", <Code2 key="c" className="h-3.5 w-3.5" />],
                      [p.open_issues, "to review", <Bug key="b" className="h-3.5 w-3.5" />],
                    ].map(([n, label, icon]) => (
                      <div key={String(label)} className="rounded-xl bg-slate-50 px-2 py-2">
                        <div className="text-lg font-semibold tabular-nums text-slate-900">{n as number}</div>
                        <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500">{icon}{label as string}</div>
                      </div>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {data.runs.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent runs</h2>
              <div className="card divide-y divide-slate-100 overflow-hidden">
                {data.runs.map((r) => (
                  <Link key={r.id} to={`/runs/${r.id}`} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50">
                    {r.status === "completed" && !r.counts.failed ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <PlayCircle className="h-5 w-5 shrink-0 text-slate-400" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{r.project_name} · {r.name}</div>
                      <div className="mt-1.5 max-w-sm"><RunProgress run={r} /></div>
                    </div>
                    <div className="hidden text-right text-xs text-slate-500 sm:block">
                      <span className="tabular-nums">{r.counts.passed ?? 0}/{r.total}</span> passed · {r.device}<br />{timeAgo(r.created_at)}
                    </div>
                    <Badge value={r.status} />
                    <ArrowRight className="h-4 w-4 text-slate-300" />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
