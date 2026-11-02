import { useEffect, useState } from "react";
import { ClipboardPaste, Download, FileSpreadsheet, Link2, Sparkles, Upload } from "lucide-react";
import { api } from "../lib/api";
import type { Run, Story } from "../lib/types";
import { Field, Modal, Segmented, Spinner, readFileBase64, useAction } from "./ui";

type Source = "url" | "file" | "paste";
type Mapping = Record<string, number | null> & { header_row: number; result_columns: number[] };
interface Preview {
  name: string | null;
  headers: string[];
  mapping: Mapping;
  total: number;
  rows: string[][];
}

const FIELDS: [string, string][] = [
  ["code", "Test case no."],
  ["title", "Scenario / title"],
  ["preconditions", "Pre-conditions"],
  ["steps", "Steps"],
  ["test_data", "Test input"],
  ["expected", "Expected result"],
  ["type", "Test type"],
  ["owner", "QA / owner"],
  ["remarks", "Remarks"],
];

export function ImportSheetModal({ story, open, onClose, onImported }: { story: Story; open: boolean; onClose: () => void; onImported: () => void }) {
  const { busy, run } = useAction();
  const [source, setSource] = useState<Source>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [sheets, setSheets] = useState<string[] | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<"input" | "preview" | "checks">("input");

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setSheets(null);
      setPhase("input");
    }
  }, [open]);

  const body = (extra: object = {}) => ({
    ...(source === "url" ? { url } : source === "file" ? { fileBase64: file?.base64, fileName: file?.name, sheetName: sheetName || undefined } : { text }),
    ...extra,
  });

  const read = () =>
    run("read", async () => {
      const r = await api.post<Preview & { sheets?: string[] }>(`/stories/${story.id}/import-sheet`, body());
      if (r.sheets) {
        setSheets(r.sheets);
        setSheetName(r.sheets[0] ?? "");
        return;
      }
      setPreview(r);
      setPhase("preview");
    });

  const commit = () =>
    run("commit", async () => {
      await api.post(`/stories/${story.id}/import-sheet`, body({ commit: true, mapping: preview!.mapping }));
      setPhase("checks");
      try {
        await api.post(`/stories/${story.id}/expand`, {});
      } finally {
        onImported();
        onClose();
      }
    }, "Test cases imported and checks derived");

  const setMap = (field: string, idx: number | null) => setPreview((p) => (p ? { ...p, mapping: { ...p.mapping, [field]: idx } } : p));
  const canRead = source === "url" ? /docs\.google\.com\/spreadsheets/.test(url) : source === "file" ? !!file && (!sheets || !!sheetName) : text.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose} title="Import test cases from your sheet" subtitle="Your IDs, wording and columns are kept — results can be exported back in the same layout." size="xl">
      {phase === "input" && (
        <div className="space-y-5">
          <Segmented<Source>
            value={source}
            onChange={(s) => { setSource(s); setSheets(null); }}
            options={[
              { key: "url", label: <span className="flex items-center gap-1.5"><Link2 className="h-4 w-4" /> Google Sheets link</span> },
              { key: "file", label: <span className="flex items-center gap-1.5"><Upload className="h-4 w-4" /> Excel / CSV file</span> },
              { key: "paste", label: <span className="flex items-center gap-1.5"><ClipboardPaste className="h-4 w-4" /> Paste cells</span> },
            ]}
          />
          {source === "url" && (
            <Field label="Google Sheets link" hint="Open the right tab first so the link includes #gid=… . The sheet must be shared as 'Anyone with the link can view' — otherwise use File → Download → .xlsx and upload it.">
              <input className="input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit?gid=1578289402#gid=1578289402" />
            </Field>
          )}
          {source === "file" && (
            <div className="space-y-4">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center hover:border-brand-500 hover:bg-brand-50/30">
                <FileSpreadsheet className="h-8 w-8 text-brand-500" />
                <span className="text-sm font-medium text-slate-700">{file ? file.name : "Choose an .xlsx or .csv file"}</span>
                <span className="text-xs text-slate-500">Exported from Google Sheets or Excel</span>
                <input type="file" accept=".xlsx,.csv,.tsv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFile({ name: f.name, base64: await readFileBase64(f) }); setSheets(null); } }} />
              </label>
              {sheets && (
                <Field label="Which tab?">
                  <select className="input" value={sheetName} onChange={(e) => setSheetName(e.target.value)}>{sheets.map((s) => <option key={s}>{s}</option>)}</select>
                </Field>
              )}
            </div>
          )}
          {source === "paste" && (
            <Field label="Paste the rows (including the header row)" hint="Select the cells in Google Sheets / Excel, copy, and paste here.">
              <textarea className="input min-h-[260px] font-mono text-[12px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={"Test Case No.\tTest Scenario\tPre-conditions\tStep Definition\tTest input\tExpected Result\tTest Type\tQA\nTC_01\t…"} />
            </Field>
          )}
          <div className="flex justify-end">
            <button className="btn-primary" disabled={!canRead || busy === "read"} onClick={read}>{busy === "read" ? <Spinner /> : <FileSpreadsheet className="h-4 w-4" />} {sheets && source === "file" ? "Read tab" : "Read sheet"}</button>
          </div>
        </div>
      )}

      {phase === "preview" && preview && (
        <div className="space-y-5">
          <div className="rounded-xl bg-brand-50/60 px-4 py-3 text-sm text-brand-900">
            Found <b>{preview.total}</b> test case rows{preview.name ? <> in <b>{preview.name}</b></> : null}. Check the column mapping below — it was detected automatically.
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {FIELDS.map(([key, label]) => (
              <Field key={key} label={label}>
                <select className="input py-1.5" value={preview.mapping[key] ?? ""} onChange={(e) => setMap(key, e.target.value === "" ? null : Number(e.target.value))}>
                  <option value="">— none —</option>
                  {preview.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </Field>
            ))}
          </div>
          {preview.mapping.result_columns.length > 0 && (
            <p className="text-sm text-slate-600">
              Result columns kept for export: {preview.mapping.result_columns.map((i) => <span key={i} className="mr-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-mono text-xs text-emerald-700">{preview.headers[i]}</span>)}
            </p>
          )}
          <div className="max-h-[38vh] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-left">
              <thead>
                <tr>{FIELDS.filter(([k]) => preview.mapping[k] != null).map(([k, l]) => <th key={k} className="th">{l}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 12).map((r, i) => (
                  <tr key={i}>
                    {FIELDS.filter(([k]) => preview.mapping[k] != null).map(([k]) => (
                      <td key={k} className="td max-w-[280px]"><div className="line-clamp-3 text-[13px]">{r[preview.mapping[k]!]}</div></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <button className="btn-ghost" onClick={() => setPhase("input")}>Back</button>
            <button className="btn-primary" disabled={!!busy} onClick={commit}>Import {preview.total} test cases</button>
          </div>
        </div>
      )}

      {phase === "checks" && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Spinner className="h-8 w-8 text-brand-600" />
          <div className="font-medium text-slate-900">Imported. Claude is deriving concrete checks…</div>
          <p className="max-w-md text-sm text-slate-500"><Sparkles className="mr-1 inline h-4 w-4 text-brand-500" />Each scenario is split into exact, verifiable expectations (every validation message, limit and default) and linked to the story's requirements.</p>
        </div>
      )}
    </Modal>
  );
}

export function ExportSheetModal({ story, projectId, open, onClose }: { story: Story; projectId: string; open: boolean; onClose: () => void }) {
  const columns = story.sheet?.result_columns?.length ? story.sheet.result_columns : ["Web- V1.1"];
  const [column, setColumn] = useState(columns[columns.length - 1]);
  const [custom, setCustom] = useState("");
  const [runId, setRunId] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  useEffect(() => {
    if (open) api.get<Run[]>(`/projects/${projectId}/runs?storyId=${story.id}`).then((r) => setRuns(r.filter((x) => x.status === "completed")));
  }, [open, projectId, story.id]);
  const chosen = column === "__custom" ? custom.trim() : column;
  const href = `/api/stories/${story.id}/export.xlsx?column=${encodeURIComponent(chosen)}${runId ? `&runId=${runId}` : ""}`;

  return (
    <Modal open={open} onClose={onClose} title="Export results to Excel" subtitle="Same columns as your sheet, with the result column filled (Pass / Fail / Blocked) and defects in Remarks. Includes Defects and Coverage tabs.">
      <div className="space-y-4">
        <Field label="Write results into column">
          <select className="input" value={column} onChange={(e) => setColumn(e.target.value)}>
            {columns.map((c) => <option key={c}>{c}</option>)}
            <option value="__custom">New column…</option>
          </select>
        </Field>
        {column === "__custom" && <Field label="New column name"><input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Web- V1.2" autoFocus /></Field>}
        <Field label="Results from">
          <select className="input" value={runId} onChange={(e) => setRunId(e.target.value)}>
            <option value="">Latest result of each test case</option>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.device}</option>)}
          </select>
        </Field>
        <div className="flex justify-end">
          <a className={`btn-primary ${chosen ? "" : "pointer-events-none opacity-50"}`} href={href} onClick={() => setTimeout(onClose, 300)}>
            <Download className="h-4 w-4" /> Download .xlsx
          </a>
        </div>
      </div>
    </Modal>
  );
}
