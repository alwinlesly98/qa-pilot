import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Accessibility, AlertTriangle, Bot, Bug, CheckCircle2, CircleDashed, CircleSlash, Code2, Download, FileText, Film, Layout, ListChecks, Loader2, MinusCircle, RotateCcw, Square, Trash2, XCircle,
} from "lucide-react";
import { api } from "../lib/api";
import type { Build, ExecutedStep, Issue, Project, Result, Run } from "../lib/types";
import { Badge, Modal, Spinner, Stat, Tabs, useAction } from "../components/ui";
import { IssueCard } from "../components/ProjectTabs";
import { RunProgress } from "./Dashboard";

interface RunData {
  run: Run;
  project: Project;
  build: Build | null;
  results: Result[];
  issues: Issue[];
  specs: { id: string; test_case_id: string; status: string; result_id: string }[];
}

const ICON: Record<string, ReactElement> = {
  passed: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  failed: <XCircle className="h-4 w-4 text-red-600" />,
  blocked: <CircleSlash className="h-4 w-4 text-amber-600" />,
  flaky: <AlertTriangle className="h-4 w-4 text-purple-600" />,
  error: <XCircle className="h-4 w-4 text-slate-500" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-blue-600" />,
  pending: <CircleDashed className="h-4 w-4 text-slate-400" />,
  cancelled: <CircleSlash className="h-4 w-4 text-slate-400" />,
};
const FE_CATEGORIES = ["frontend", "accessibility", "content"];

function StepRow({ step, onZoom }: { step: ExecutedStep; onZoom: (src: string) => void }) {
  const v = step.verification;
  return (
    <li className="flex gap-3 py-3">
      <div className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums ${step.ok ? "bg-slate-100 text-slate-600" : "bg-red-100 text-red-700"}`}>{step.n}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] uppercase text-slate-600">{step.action.type}</span>
          <span className="font-medium text-slate-900">{step.action.description}</span>
          <span className="text-xs text-slate-400">step {step.testStep}</span>
        </div>
        <div className="mt-0.5 flex items-start gap-1.5 text-xs text-slate-500"><Bot className="mt-0.5 h-3 w-3 shrink-0" />{step.thought}</div>
        {v && (
          <div className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-xs ${v.passed ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
            {v.passed ? "✔" : "✘"} {v.check_id && <b className="font-mono">{v.check_id} </b>}<b>{v.expectation}</b> — {v.observation}
          </div>
        )}
        {!step.ok && <div className="mt-1 text-xs text-red-600">{step.result}</div>}
        {step.action.type === "read_email" && step.ok && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">{step.result}</pre>}
        {step.action.type === "finish" && <div className="mt-1 text-xs font-medium text-slate-700">{step.result}</div>}
      </div>
      {step.screenshot && (
        <button onClick={() => onZoom(step.screenshot!)} className="h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 hover:ring-2 hover:ring-brand-500">
          <img src={step.screenshot} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
        </button>
      )}
    </li>
  );
}

function BrowserFrame({ url, frame }: { url: string; frame: string | null }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-xl shadow-slate-900/5">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100/80 px-3 py-2">
        <div className="flex gap-1.5"><span className="h-3 w-3 rounded-full bg-red-400" /><span className="h-3 w-3 rounded-full bg-amber-400" /><span className="h-3 w-3 rounded-full bg-emerald-400" /></div>
        <div className="flex-1 truncate rounded-lg bg-white px-3 py-1 font-mono text-xs text-slate-500">{url || "about:blank"}</div>
        <span className="flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />Live</span>
      </div>
      <div className="grid aspect-[16/10] place-items-center bg-slate-950">
        {frame ? <img src={frame} alt="Live browser" className="max-h-full max-w-full object-contain" /> : <div className="flex items-center gap-2 text-sm text-slate-400"><Spinner /> Waiting for the browser…</div>}
      </div>
    </div>
  );
}

function ChecksMatrix({ result }: { result: Result }) {
  if (!result.checks?.length) return null;
  const icon = { passed: <CheckCircle2 className="h-4 w-4 text-emerald-600" />, failed: <XCircle className="h-4 w-4 text-red-600" />, not_run: <MinusCircle className="h-4 w-4 text-slate-400" /> };
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full">
        <thead>
          <tr><th className="th w-8" /><th className="th w-14">Check</th><th className="th">Expectation</th><th className="th">Observed / reason</th></tr>
        </thead>
        <tbody>
          {result.checks.map((c) => (
            <tr key={c.id} className={c.status === "failed" ? "bg-red-50/50" : ""}>
              <td className="td">{icon[c.status]}</td>
              <td className="td font-mono text-xs">{c.id}</td>
              <td className="td">{c.text}</td>
              <td className={`td text-[13px] ${c.status === "failed" ? "text-red-700" : "text-slate-500"}`}>{c.observation ?? c.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type View = "tests" | "frontend";

export default function RunView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<RunData | null>(null);
  const [view, setView] = useState<View>("tests");
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [frame, setFrame] = useState<{ resultId: string; src: string } | null>(null);
  const [liveSteps, setLiveSteps] = useState<Record<string, ExecutedStep[]>>({});
  const [thinking, setThinking] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<{ level: string; message: string }[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  const { busy, run } = useAction();
  const reloadTimer = useRef<number | undefined>(undefined);

  const load = useCallback(() => api.get<RunData>(`/runs/${id}`).then(setData), [id]);
  const scheduleReload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(load, 300);
  }, [load]);

  useEffect(() => {
    load();
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?runId=${id}`);
    ws.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      if (e.type === "frame") setFrame({ resultId: e.resultId, src: `data:image/jpeg;base64,${e.data}` });
      else if (e.type === "step") setLiveSteps((s) => ({ ...s, [e.resultId]: [...(s[e.resultId] ?? []), e.step] }));
      else if (e.type === "thinking") setThinking((t) => ({ ...t, [e.resultId]: e.text }));
      else if (e.type === "log") {
        setLogs((l) => [...l.slice(-80), e]);
        if (e.message.startsWith("Front-end:")) scheduleReload();
      } else scheduleReload();
    };
    const poll = setInterval(load, 10_000); // safety net if the socket drops
    return () => {
      ws.close();
      clearInterval(poll);
    };
  }, [id, load, scheduleReload]);

  const running = data?.results.find((r) => r.status === "running");
  const activeLogin = frame?.resultId === "login" && data?.run.status === "running" && !running;
  const currentId = follow ? (activeLogin ? "login" : running?.id ?? selected ?? data?.results[0]?.id) : selected;
  const current = data?.results.find((r) => r.id === currentId);
  const steps = useMemo(() => {
    if (!currentId) return [];
    if (current && current.steps.length) return current.steps;
    return liveSteps[currentId] ?? [];
  }, [current, currentId, liveSteps]);
  const isLive = currentId === "login" || current?.status === "running";

  if (!data) return <Spinner className="h-6 w-6 text-slate-400" />;
  const { run: r, results, issues } = data;
  const functional = issues.filter((i) => !FE_CATEGORIES.includes(i.category));
  const frontend = issues.filter((i) => FE_CATEGORIES.includes(i.category));
  const testIssues = functional.filter((i) => i.result_id === currentId);
  const spec = data.specs.find((s) => s.test_case_id === current?.test_case_id);
  const done = !["queued", "running"].includes(r.status);
  const checkTotals = results.reduce((a, x) => { for (const c of x.checks ?? []) a[c.status] = (a[c.status] ?? 0) + 1; return a; }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to={`/projects/${r.project_id}?tab=runs`} className="text-sm text-slate-500 hover:text-brand-600">← {data.project.name}</Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold tracking-tight">{r.name} <Badge value={r.status} /></h1>
          <p className="text-sm text-slate-500">{r.device}{data.build ? ` · build ${data.build.version}` : ""} · {data.build?.site_url || data.project.site_url}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!done && <button className="btn-secondary text-red-600" onClick={() => run("cancel", () => api.post(`/runs/${r.id}/cancel`))}><Square className="h-4 w-4" /> Stop</button>}
          {done && (
            <>
              <button
                className="btn-ghost text-red-600"
                title="Delete this run and its videos/screenshots"
                disabled={!!busy}
                onClick={() => confirm("Delete this run, its screenshots, videos and draft issues?") && run("delete", async () => { await api.del(`/runs/${r.id}`); navigate(`/projects/${r.project_id}?tab=runs`); })}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button className="btn-secondary" disabled={!!busy} onClick={() => run("rerun", async () => navigate(`/runs/${(await api.post<Run>(`/runs/${r.id}/rerun`, { failedOnly: true })).id}`))}>
                <RotateCcw className="h-4 w-4" /> Re-run failed
              </button>
              <button className="btn-secondary" disabled={!!busy} onClick={() => run("specs", async () => { await api.post(`/runs/${r.id}/specs`); await load(); }, "Playwright specs generated and validated")} title="Claude writes a .spec.ts for every test case and runs it to prove it">
                {busy === "specs" ? <><Spinner /> Writing & validating specs…</> : <><Code2 className="h-4 w-4" /> Generate Playwright</>}
              </button>
              <a className="btn-secondary" href={`/api/runs/${r.id}/report.html`} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" /> View report</a>
              <a className="btn-primary" href={`/api/runs/${r.id}/report.html?download=1`}><Download className="h-4 w-4" /> Download report</a>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Passed" value={r.counts.passed ?? 0} tone="green" />
        <Stat label="Failed" value={r.counts.failed ?? 0} tone={(r.counts.failed ?? 0) ? "red" : "slate"} />
        <Stat label="Blocked" value={r.counts.blocked ?? 0} tone={(r.counts.blocked ?? 0) ? "amber" : "slate"} />
        <Stat label="Checks" value={<span>{checkTotals.passed ?? 0}<span className="text-base text-slate-400">/{(checkTotals.passed ?? 0) + (checkTotals.failed ?? 0) + (checkTotals.not_run ?? 0)}</span></span>} tone="indigo" hint={`${checkTotals.failed ?? 0} failed · ${checkTotals.not_run ?? 0} not run`} icon={<ListChecks className="h-4 w-4" />} />
        <Stat label="Functional bugs" value={functional.length} tone={functional.length ? "red" : "slate"} icon={<Bug className="h-4 w-4" />} />
        <Stat label="UI / content / a11y" value={frontend.length} tone={frontend.length ? "cyan" : "slate"} icon={<Layout className="h-4 w-4" />} />
      </div>
      <RunProgress run={r} />

      {r.ai_summary && (
        <div className={`card border-l-4 p-5 ${r.ai_summary.verdict === "ready" ? "border-l-emerald-500" : r.ai_summary.verdict === "not_ready" ? "border-l-red-500" : "border-l-amber-500"}`}>
          <div className="flex flex-wrap items-center gap-2"><Bot className="h-4 w-4 text-brand-600" /><Badge value={r.ai_summary.verdict} /><span className="font-semibold text-slate-900">{r.ai_summary.headline}</span></div>
          <div className="mt-3 grid gap-4 text-sm md:grid-cols-2">
            <ul className="list-disc space-y-1 pl-5 text-slate-700">{r.ai_summary.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
            {r.ai_summary.risks.length > 0 && <ul className="list-disc space-y-1 pl-5 text-amber-800">{r.ai_summary.risks.map((h, i) => <li key={i}>{h}</li>)}</ul>}
          </div>
        </div>
      )}
      {r.error && <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{r.error}</div>}

      <Tabs<View>
        value={view}
        onChange={setView}
        tabs={[
          { key: "tests", label: "Test cases", count: results.length, icon: <ListChecks className="h-4 w-4" /> },
          { key: "frontend", label: "Front-end, content & accessibility", count: frontend.length, icon: <Accessibility className="h-4 w-4" /> },
        ]}
      />

      {view === "frontend" ? (
        frontend.length ? (
          <div className="grid gap-3">{frontend.map((i) => <IssueCard key={i.id} issue={i} />)}</div>
        ) : (
          <div className="card p-6 text-sm text-slate-500">{done ? "No front-end, content or accessibility issues found on the screens visited." : "Every new screen is scanned (WCAG 2.2 AA + layout) and reviewed by Claude against the story — findings appear here live."}</div>
        )
      ) : (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <div className="card h-fit divide-y divide-slate-100 overflow-hidden">
            {(activeLogin || logs.some((l) => l.message.startsWith("Signing in"))) && (
              <button onClick={() => { setFollow(false); setSelected("login"); }} className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm ${currentId === "login" ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                {activeLogin ? ICON.running : <CheckCircle2 className="h-4 w-4 text-slate-400" />}<span className="font-mono text-xs text-slate-400">AUTH</span> Session sign-in
              </button>
            )}
            {results.map((res) => {
              const failedChecks = (res.checks ?? []).filter((c) => c.status === "failed").length;
              return (
                <button key={res.id} onClick={() => { setFollow(false); setSelected(res.id); }} className={`flex w-full items-start gap-2.5 px-4 py-3 text-left text-sm ${res.id === currentId ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                  <span className="mt-0.5">{ICON[res.status] ?? ICON.pending}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-slate-400">{res.test_case.code}</span> <span className="font-medium text-slate-900">{res.test_case.title}</span>
                    {res.duration_ms != null && (
                      <span className="block text-xs text-slate-400">
                        {(res.duration_ms / 1000).toFixed(0)}s · {res.steps.length} steps{res.checks?.length ? ` · ${res.checks.length - failedChecks}/${res.checks.length} checks` : ""}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {!done && (
              <label className="flex items-center gap-2 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                <input type="checkbox" className="accent-brand-600" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow the running test
              </label>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            {isLive ? (
              <>
                <BrowserFrame url={steps[steps.length - 1]?.url ?? ""} frame={frame && frame.resultId === currentId ? frame.src : null} />
                <div className="card flex items-start gap-3 p-4">
                  <div className="rounded-full bg-brand-50 p-2 text-brand-600"><Bot className="h-4 w-4" /></div>
                  <div className="text-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Claude is thinking</div>{thinking[currentId!] ?? "Reading the page…"}</div>
                </div>
              </>
            ) : current ? (
              <div className="card space-y-4 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge value={current.status} />
                  <h2 className="font-semibold text-slate-900">{current.test_case.code} · {current.test_case.title}</h2>
                </div>
                {current.summary && <p className="text-sm text-slate-700">{current.summary}</p>}
                <ChecksMatrix result={current} />
                {!current.checks?.length && <div className="text-sm text-slate-500"><b>Expected:</b> {current.test_case.expected_result}</div>}
                {testIssues.length > 0 && (
                  <div className="space-y-2">
                    {testIssues.map((issue) => (
                      <Link key={issue.id} to={`/issues/${issue.id}`} className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm transition hover:border-red-400">
                        <Bug className="h-4 w-4 shrink-0 text-red-600" />
                        <span className="min-w-0 flex-1"><b className="text-slate-900">{issue.check_id ? `${issue.check_id} · ` : ""}{issue.title}</b><br /><span className="text-red-700">Review, annotate and send to Jira →</span></span>
                        <Badge value={issue.status} />
                      </Link>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {current.video_url && <a className="btn-secondary" href={current.video_url} target="_blank" rel="noreferrer"><Film className="h-4 w-4" /> Video</a>}
                  {current.trace_url && <a className="btn-secondary" href={current.trace_url} download title="Open with: npx playwright show-trace trace.zip (or trace.playwright.dev)"><Download className="h-4 w-4" /> Playwright trace</a>}
                  {current.steps.length > 0 && current.test_case_id && (
                    <button className="btn-secondary" disabled={!!busy} onClick={() => run("spec", async () => { await api.post(`/results/${current.id}/spec`); await load(); }, "Playwright spec written and validated — see the Playwright tab")}>
                      {busy === "spec" ? <><Spinner /> Writing & validating…</> : <><Code2 className="h-4 w-4" /> {spec ? "Regenerate" : "Generate"} Playwright</>}
                    </button>
                  )}
                  {spec && <Link to={`/projects/${r.project_id}?tab=automation`}><Badge value={spec.status} /></Link>}
                </div>
                {current.video_url && <video src={current.video_url} controls className="max-h-[70vh] w-full rounded-xl border border-slate-200 bg-black object-contain" />}
              </div>
            ) : null}

            {steps.length > 0 && (
              <div className="card px-5">
                <ol className="divide-y divide-slate-100">{steps.map((s) => <StepRow key={s.n} step={s} onZoom={setZoom} />)}</ol>
              </div>
            )}

            {logs.length > 0 && (
              <div className="card max-h-44 overflow-y-auto bg-slate-950 p-3 font-mono text-xs">
                {logs.map((l, i) => <div key={i} className={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-300" : "text-slate-300"}>{l.message}</div>)}
              </div>
            )}
          </div>
        </div>
      )}

      <Modal open={!!zoom} onClose={() => setZoom(null)} title="Screenshot" size="lg">
        {zoom && <img src={zoom} alt="" className="mx-auto max-h-[80vh] max-w-full rounded-xl border border-slate-200" />}
      </Modal>
    </div>
  );
}
