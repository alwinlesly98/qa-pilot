import { useCallback, useEffect, useRef, useState } from "react";
import { Code2, Download, ExternalLink, FileCode2, Play, Save, Terminal, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { Project, Spec, SuiteRun } from "../lib/types";
import { Badge, Drawer, Empty, Spinner, timeAgo, useAction } from "./ui";
import { useDevices } from "./ProjectForm";

function CodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const lines = value.split("\n").length;
  const gutter = useRef<HTMLDivElement>(null);
  return (
    <div className="flex overflow-hidden rounded-xl border border-slate-800 bg-slate-950 font-mono text-[12.5px] leading-[1.6]">
      <div ref={gutter} className="select-none overflow-hidden border-r border-slate-800 px-3 py-3 text-right text-slate-600">
        {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <textarea
        spellCheck={false}
        className="min-h-[60vh] flex-1 resize-none bg-transparent px-3 py-3 text-slate-100 outline-hidden"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const t = e.currentTarget;
            const { selectionStart: s, selectionEnd: end } = t;
            onChange(value.slice(0, s) + "  " + value.slice(end));
            requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
          }
        }}
      />
    </div>
  );
}

function SuiteRunCard({ run, live }: { run: SuiteRun; live: string[] }) {
  const s = run.summary?.stats;
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <Badge value={run.status} />
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-medium text-slate-900">{run.spec_ids.length} spec(s)</span> <span className="text-slate-500">· {run.device} · {timeAgo(run.created_at)}</span>
          {s && (
            <div className="mt-0.5 text-xs text-slate-500">
              <span className="text-emerald-600">{s.expected} passed</span> · <span className="text-red-600">{s.unexpected} failed</span> · {s.flaky} flaky · {s.skipped} skipped · {(s.duration / 1000).toFixed(0)}s
            </div>
          )}
        </div>
        {run.summary?.hasReport && (
          <a className="btn-secondary" href={run.report_url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" /> Playwright report
          </a>
        )}
      </div>
      {run.status === "running" && (
        <pre className="max-h-64 overflow-y-auto border-t border-slate-800 bg-slate-950 px-5 py-3 font-mono text-[11.5px] leading-relaxed text-slate-300">
          {live.length ? live.join("\n") : "Starting Playwright…"}
        </pre>
      )}
      {run.status === "error" && run.log && <pre className="max-h-64 overflow-y-auto border-t border-slate-800 bg-slate-950 px-5 py-3 font-mono text-[11.5px] text-red-300">{run.log.slice(-4000)}</pre>}
    </div>
  );
}

export default function AutomationTab({ project }: { project: Project }) {
  const devices = useDevices();
  const [specs, setSpecs] = useState<Spec[] | null>(null);
  const [runs, setRuns] = useState<SuiteRun[]>([]);
  const [device, setDevice] = useState(project.default_device);
  const [editing, setEditing] = useState<Spec | null>(null);
  const [code, setCode] = useState("");
  const [live, setLive] = useState<Record<string, string[]>>({});
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([api.get<Spec[]>(`/projects/${project.id}/specs`), api.get<SuiteRun[]>(`/projects/${project.id}/suite-runs`)]);
    setSpecs(s);
    setRuns(r);
  }, [project.id]);
  useEffect(() => void load(), [load]);

  // Stream logs of running suite runs.
  const runningId = runs.find((r) => r.status === "running")?.id;
  useEffect(() => {
    if (!runningId) return;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?runId=suite:${runningId}`);
    ws.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === "log") setLive((l) => ({ ...l, [runningId]: [...(l[runningId] ?? []).slice(-300), e.message] }));
      else void load();
    };
    const poll = setInterval(load, 8000);
    return () => {
      ws.close();
      clearInterval(poll);
    };
  }, [runningId, load]);

  const startRun = (specIds?: string[]) =>
    run("run", async () => {
      await api.post(`/projects/${project.id}/suite-runs`, { specIds, device });
      await load();
    });

  if (!specs) return <Spinner className="h-6 w-6 text-slate-400" />;
  const counts = { passing: 0, failing: 0, broken: 0, draft: 0, ...Object.fromEntries(["passing", "failing", "broken", "draft"].map((k) => [k, specs.filter((s) => s.status === k).length])) };

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center gap-4 p-5">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white"><Code2 className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900">Playwright regression suite</div>
          <div className="text-sm text-slate-500">
            Claude writes a real <code className="font-mono text-xs">.spec.ts</code> from each AI run, then runs it to prove it works. Assertions come straight from the story; failing specs on known defects stay failing until the bug is fixed.
          </div>
        </div>
        <select className="input w-44" value={device} onChange={(e) => setDevice(e.target.value)}>
          {devices.map((d) => <option key={d}>{d}</option>)}
        </select>
        <a className={`btn-secondary ${specs.length ? "" : "pointer-events-none opacity-50"}`} href={`/api/projects/${project.id}/suite.zip`}><Download className="h-4 w-4" /> Download suite</a>
        <button className="btn-primary" disabled={!specs.length || !!busy || !!runningId} onClick={() => startRun()}>
          {busy === "run" || runningId ? <Spinner /> : <Play className="h-4 w-4" />} Run all specs
        </button>
      </div>

      {!specs.length ? (
        <Empty icon={<FileCode2 className="h-6 w-6" />} title="No Playwright specs yet">
          Open a finished run and click <b>Generate Playwright</b> — for one test case or the whole run.
        </Empty>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3 text-xs">
            <Badge value="passing">{counts.passing} passing</Badge>
            <Badge value="failing">{counts.failing} fail on known defect</Badge>
            <Badge value="broken">{counts.broken} need attention</Badge>
            <Badge value="draft">{counts.draft} not run yet</Badge>
          </div>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">File</th>
                <th className="th">Test case</th>
                <th className="th">Story</th>
                <th className="th">Status</th>
                <th className="th">Updated</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {specs.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => { setEditing(s); setCode(s.code); }}>
                  <td className="td font-mono text-xs text-slate-600">{s.file}</td>
                  <td className="td"><span className="mr-1.5 font-mono text-xs text-slate-400">{s.tc_code}</span>{s.title}</td>
                  <td className="td text-slate-500">{s.story_title}</td>
                  <td className="td"><Badge value={s.status} /></td>
                  <td className="td whitespace-nowrap text-xs text-slate-500">{timeAgo(s.updated_at)}</td>
                  <td className="td text-right">
                    <button className="btn-ghost p-1.5" title="Run this spec" disabled={!!runningId} onClick={(e) => { e.stopPropagation(); startRun([s.id]); }}><Play className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {runs.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Terminal className="h-4 w-4" /> Suite runs</h3>
          {runs.map((r) => <SuiteRunCard key={r.id} run={r} live={live[r.id] ?? []} />)}
        </section>
      )}

      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={<span className="font-mono text-sm">{editing?.file}</span>}
        subtitle={editing && <span className="flex items-center gap-2"><Badge value={editing.status} /> {editing.title}</span>}
        footer={
          editing && (
            <div className="flex items-center justify-between">
              <button className="btn-ghost text-red-600" onClick={() => run("del", async () => { await api.del(`/specs/${editing.id}`); setEditing(null); await load(); })}><Trash2 className="h-4 w-4" /> Delete</button>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={!!runningId} onClick={() => startRun([editing.id])}><Play className="h-4 w-4" /> Run</button>
                <button className="btn-primary" disabled={code === editing.code || busy === "save"} onClick={() => run("save", async () => { const s = await api.put<Spec>(`/specs/${editing.id}`, { code }); setEditing({ ...editing, ...s }); await load(); }, "Spec saved")}>
                  <Save className="h-4 w-4" /> Save
                </button>
              </div>
            </div>
          )
        }
      >
        {editing?.last_error && (
          <details className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-red-700">Last run output</summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-red-800">{editing.last_error}</pre>
          </details>
        )}
        <CodeEditor value={code} onChange={setCode} />
      </Drawer>
    </div>
  );
}
