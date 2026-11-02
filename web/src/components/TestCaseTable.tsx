import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardPaste, Download, FileSpreadsheet, ListChecks, Play, Plus, Save, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { api } from "../lib/api";
import type { Check, Story, TestCase } from "../lib/types";
import { Badge, Drawer, Empty, Field, Modal, Spinner, useAction } from "./ui";

function lines(v: string) {
  return v.split("\n");
}

function ChecksEditor({ value, onChange, requirementIds }: { value: Check[]; onChange: (c: Check[]) => void; requirementIds: string[] }) {
  const set = (i: number, patch: Partial<Check>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-2">
      {value.map((c, i) => (
        <div key={i} className="grid grid-cols-[56px_1fr_120px_auto] items-start gap-2">
          <input className="input px-2 py-1.5 text-center font-mono text-xs" value={c.id} onChange={(e) => set(i, { id: e.target.value })} />
          <textarea className="input min-h-[38px] py-1.5 text-[13px]" rows={2} value={c.text} onChange={(e) => set(i, { text: e.target.value })} />
          <input className="input px-2 py-1.5 font-mono text-xs" list="req-ids" value={c.requirement_ids.join(", ")} onChange={(e) => set(i, { requirement_ids: e.target.value.split(/[,\s]+/).filter(Boolean) })} placeholder="R-01" />
          <button className="btn-ghost p-2 text-slate-400 hover:text-red-600" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove check"><X className="h-4 w-4" /></button>
        </div>
      ))}
      <datalist id="req-ids">{requirementIds.map((r) => <option key={r} value={r} />)}</datalist>
      <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => onChange([...value, { id: `C${value.length + 1}`, text: "", requirement_ids: [] }])}>
        <Plus className="h-3.5 w-3.5" /> Add check
      </button>
    </div>
  );
}

function TestCaseDrawer({ tc, story, onClose, onSaved, onDeleted, onRun }: { tc: TestCase | null; story: Story; onClose: () => void; onSaved: (t: TestCase) => void; onDeleted: (id: string) => void; onRun: (ids: string[]) => void }) {
  const [d, setD] = useState<TestCase | null>(tc);
  const { busy, run } = useAction();
  useEffect(() => setD(tc), [tc]);
  if (!tc || !d) return null;
  const dirty = JSON.stringify(d) !== JSON.stringify(tc);
  const set = <K extends keyof TestCase>(k: K, v: TestCase[K]) => setD({ ...d, [k]: v });

  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="flex items-center gap-2"><span className="font-mono text-sm text-slate-400">{d.code}</span>{d.title}</span>}
      subtitle={<span className="flex flex-wrap gap-1.5">{d.source === "ai" ? <Badge tone="indigo"><Sparkles className="h-3 w-3" />written by Claude</Badge> : <Badge tone="slate">from your sheet</Badge>}<Badge value={d.automation} /></span>}
      footer={
        <div className="flex items-center justify-between">
          <button className="btn-ghost text-red-600" onClick={() => confirm(`Delete ${d.code}?`) && run("del", async () => { await api.del(`/testcases/${d.id}`); onDeleted(d.id); })}><Trash2 className="h-4 w-4" /> Delete</button>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => onRun([d.id])}><Play className="h-4 w-4" /> Run</button>
            <button className="btn-primary" disabled={!dirty || busy === "save"} onClick={() => run("save", async () => onSaved(await api.put<TestCase>(`/testcases/${d.id}`, { ...d, steps: d.steps.filter((s) => s.trim()) })), "Saved")}>
              {busy === "save" ? <Spinner /> : <Save className="h-4 w-4" />} Save
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <Field label="Test case no."><input className="input font-mono" value={d.code} onChange={(e) => set("code", e.target.value)} /></Field>
          <Field label="Test scenario"><input className="input" value={d.title} onChange={(e) => set("title", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Test type"><input className="input" value={d.type} onChange={(e) => set("type", e.target.value)} list="tc-types" /></Field>
          <Field label="Priority">
            <select className="input" value={d.priority} onChange={(e) => set("priority", e.target.value)}>{["high", "medium", "low"].map((p) => <option key={p}>{p}</option>)}</select>
          </Field>
          <Field label="QA"><input className="input" value={d.owner ?? ""} onChange={(e) => set("owner", e.target.value)} /></Field>
          <Field label="Automation">
            <select className="input" value={d.automation} onChange={(e) => set("automation", e.target.value as TestCase["automation"])}>
              <option value="auto">auto</option>
              <option value="partial">partial</option>
              <option value="manual">manual</option>
            </select>
          </Field>
        </div>
        <datalist id="tc-types">{["Sanity", "Regression", "Integration", "Functional", "Negative", "UI", "Smoke"].map((t) => <option key={t} value={t} />)}</datalist>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Session">
            <select className="input" value={d.requires_login ? "1" : "0"} onChange={(e) => set("requires_login", e.target.value === "1")}>
              <option value="0">Starts as guest (signed out)</option>
              <option value="1">Starts signed in</option>
            </select>
          </Field>
          <Field label="Included in runs">
            <select className="input" value={d.enabled ? "1" : "0"} onChange={(e) => set("enabled", e.target.value === "1")}>
              <option value="1">Yes</option>
              <option value="0">No (excluded)</option>
            </select>
          </Field>
        </div>
        <Field label="Pre-conditions"><textarea className="input min-h-[52px]" value={d.preconditions} onChange={(e) => set("preconditions", e.target.value)} /></Field>
        <Field label="Step definition (one per line)" hint="Use {{VARIABLES}} from Project → Settings → Test data, e.g. {{OTP}}.">
          <textarea className="input min-h-[120px] text-[13px]" value={d.steps.join("\n")} onChange={(e) => set("steps", lines(e.target.value))} />
        </Field>
        <Field label="Test input"><textarea className="input min-h-[52px]" value={d.test_data} onChange={(e) => set("test_data", e.target.value)} /></Field>
        <Field label="Expected result"><textarea className="input min-h-[80px]" value={d.expected_result} onChange={(e) => set("expected_result", e.target.value)} /></Field>
        <div>
          <div className="label flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" /> Checks — each verified separately, with its own pass/fail</div>
          <ChecksEditor value={d.checks} onChange={(c) => set("checks", c)} requirementIds={story.requirements.map((r) => r.id)} />
        </div>
        <Field label="Covers requirements">
          <input className="input font-mono text-xs" list="req-ids" value={d.requirement_ids.join(", ")} onChange={(e) => set("requirement_ids", e.target.value.split(/[,\s]+/).filter(Boolean))} />
        </Field>
      </div>
    </Drawer>
  );
}

export default function TestCaseTable({
  story, cases, reload, onRun, onImport, onExport, generateRequest,
}: { story: Story; cases: TestCase[]; reload: () => Promise<void>; onRun: (ids: string[]) => void; onImport: () => void; onExport: () => void; generateRequest: { guidance: string; n: number } | null }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TestCase | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const { busy, run } = useAction();

  useEffect(() => {
    if (generateRequest) {
      setGuidance(generateRequest.guidance);
      setGenOpen(true);
    }
  }, [generateRequest]);

  const allSelected = cases.length > 0 && cases.every((c) => selected.has(c.id));
  const sel = [...selected];
  const missingChecks = cases.filter((c) => !c.checks.length).length;

  const generate = () =>
    run("gen", async () => {
      await api.post(`/stories/${story.id}/generate`, { guidance });
      setGenOpen(false);
      setGuidance("");
      await reload();
    }, "Claude wrote new test cases");

  const expand = (ids?: string[]) =>
    run("expand", async () => {
      await api.post(`/stories/${story.id}/expand`, { testCaseIds: ids });
      await reload();
    }, "Checks derived");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setGenOpen(true)}><Wand2 className="h-4 w-4" /> Generate with Claude</button>
          <button className="btn-secondary" onClick={onImport}><FileSpreadsheet className="h-4 w-4" /> Import sheet</button>
          <button className="btn-secondary" onClick={() => setPasteOpen(true)}><ClipboardPaste className="h-4 w-4" /> Paste any format</button>
          <button className="btn-secondary" onClick={() => run("add", async () => { const tc = await api.post<TestCase>(`/stories/${story.id}/testcases`, { title: "New test case", steps: [""], expected_result: "" }); await reload(); setEditing(tc); })}>
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {missingChecks > 0 && (
            <button className="btn-secondary" disabled={!!busy} onClick={() => expand()} title="Split high-level scenarios into exact checks">
              {busy === "expand" ? <Spinner /> : <ListChecks className="h-4 w-4" />} Derive checks ({missingChecks})
            </button>
          )}
          <button className="btn-secondary" disabled={!cases.length} onClick={onExport}><Download className="h-4 w-4" /> Export Excel</button>
        </div>
      </div>

      {sel.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-2.5 text-sm">
          <span className="font-medium text-brand-900">{sel.length} selected</span>
          <span className="flex-1" />
          <button className="btn-ghost py-1.5" disabled={!!busy} onClick={() => expand(sel)}><ListChecks className="h-4 w-4" /> Re-derive checks</button>
          <button className="btn-ghost py-1.5 text-red-600" disabled={!!busy} onClick={() => confirm(`Delete ${sel.length} test case(s)?`) && run("bulkdel", async () => { await api.post("/testcases/bulk-delete", { ids: sel }); setSelected(new Set()); await reload(); })}><Trash2 className="h-4 w-4" /> Delete</button>
          <button className="btn-primary py-1.5" onClick={() => onRun(sel)}><Play className="h-4 w-4" /> Run selected</button>
        </div>
      )}

      {!cases.length ? (
        <Empty icon={<FileSpreadsheet className="h-6 w-6" />} title="No test cases yet" action={<div className="flex gap-2"><button className="btn-primary" onClick={() => setGenOpen(true)}><Wand2 className="h-4 w-4" /> Generate</button><button className="btn-secondary" onClick={onImport}>Import your sheet</button></div>}>
          Import the team's sheet (Google Sheets link, Excel or pasted cells), or let Claude write test cases from the story's requirements.
        </Empty>
      ) : (
        <div className="card overflow-auto">
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr>
                <th className="th w-10"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(cases.map((c) => c.id)) : new Set())} /></th>
                <th className="th">Test case no.</th>
                <th className="th min-w-[220px]">Test scenario</th>
                <th className="th min-w-[160px]">Pre-conditions</th>
                <th className="th min-w-[240px]">Step definition</th>
                <th className="th min-w-[150px]">Test input</th>
                <th className="th min-w-[240px]">Expected result</th>
                <th className="th">Type</th>
                <th className="th">QA</th>
                <th className="th">Checks</th>
                <th className="th">Last result</th>
                <th className="th">Playwright</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} onClick={() => setEditing(c)} className={`cursor-pointer transition hover:bg-brand-50/40 ${c.enabled ? "" : "opacity-50"} ${selected.has(c.id) ? "bg-brand-50/50" : ""}`}>
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.has(c.id)} onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(c.id); else n.delete(c.id); setSelected(n); }} />
                  </td>
                  <td className="td whitespace-nowrap font-mono text-xs font-medium text-slate-900">
                    {c.code}
                    {c.source === "ai" && <Sparkles className="ml-1 inline h-3 w-3 text-brand-500" />}
                  </td>
                  <td className="td font-medium text-slate-900"><div className="line-clamp-3">{c.title}</div></td>
                  <td className="td text-slate-500"><div className="line-clamp-3">{c.preconditions}</div></td>
                  <td className="td"><div className="line-clamp-3">{c.steps.join("; ")}</div></td>
                  <td className="td text-slate-500"><div className="line-clamp-3">{c.test_data}</div></td>
                  <td className="td"><div className="line-clamp-3">{c.expected_result}</div></td>
                  <td className="td whitespace-nowrap text-xs">{c.type}</td>
                  <td className="td whitespace-nowrap text-xs text-slate-500">{c.owner}</td>
                  <td className="td whitespace-nowrap">
                    {c.checks.length ? <span className="text-xs tabular-nums text-slate-600">{c.checks.length}</span> : <span className="text-xs text-amber-600">none</span>}
                    {c.automation !== "auto" && <div className="mt-1"><Badge value={c.automation} /></div>}
                  </td>
                  <td className="td whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {c.last_result ? <Link to={`/runs/${c.last_result.run_id}`}><Badge value={c.last_result.status} /></Link> : <span className="text-xs text-slate-400">not run</span>}
                  </td>
                  <td className="td whitespace-nowrap">{c.spec ? <Badge value={c.spec.status} /> : <span className="text-xs text-slate-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TestCaseDrawer
        tc={editing}
        story={story}
        onClose={() => setEditing(null)}
        onSaved={async (t) => { setEditing(t); await reload(); }}
        onDeleted={async () => { setEditing(null); await reload(); }}
        onRun={(ids) => { setEditing(null); onRun(ids); }}
      />

      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="Generate test cases with Claude" subtitle="Written from the story's requirements, with exact checks for every validation message, limit and default. Existing cases are not duplicated.">
        <Field label="Guidance (optional)">
          <textarea className="input min-h-[110px]" value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="e.g. focus on the Delivery step, include mobile layout checks, use the team's test types (Sanity / Integration)" />
        </Field>
        <div className="mt-5 flex justify-end">
          <button className="btn-primary" disabled={busy === "gen"} onClick={generate}>{busy === "gen" ? <><Spinner /> Claude is writing…</> : <><Sparkles className="h-4 w-4" /> Generate</>}</button>
        </div>
      </Modal>

      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} title="Paste test cases in any format" subtitle="A list, Gherkin, a table from Word — Claude structures them without changing your intent." size="lg">
        <textarea className="input min-h-[300px] font-mono text-[12.5px]" value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
        <div className="mt-4 flex justify-end">
          <button className="btn-primary" disabled={!pasteText.trim() || busy === "paste"} onClick={() => run("paste", async () => { await api.post(`/stories/${story.id}/import`, { text: pasteText }); setPasteOpen(false); setPasteText(""); await reload(); }, "Test cases imported")}>
            {busy === "paste" && <Spinner />} Import
          </button>
        </div>
      </Modal>
    </div>
  );
}
