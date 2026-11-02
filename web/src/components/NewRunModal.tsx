import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { api } from "../lib/api";
import type { Build, Project, Run, Story, TestCase } from "../lib/types";
import { Badge, Field, Modal, Spinner, useAction } from "./ui";
import { useDevices } from "./ProjectForm";

export default function NewRunModal({ project, open, onClose, preselect, storyId }: { project: Project; open: boolean; onClose: () => void; preselect?: string[]; storyId?: string }) {
  const navigate = useNavigate();
  const devices = useDevices();
  const { busy, run } = useAction();
  const [builds, setBuilds] = useState<Build[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [buildId, setBuildId] = useState("");
  const [device, setDevice] = useState(project.default_device);
  const preKey = preselect?.join(",") ?? "";

  useEffect(() => {
    if (!open) return;
    Promise.all([
      api.get<Build[]>(`/projects/${project.id}/builds`),
      api.get<Story[]>(`/projects/${project.id}/stories`),
      api.get<TestCase[]>(`/projects/${project.id}/testcases${storyId ? `?storyId=${storyId}` : ""}`),
    ]).then(([b, s, c]) => {
      setBuilds(b);
      setBuildId(b[0]?.id ?? "");
      setStories(storyId ? s.filter((x) => x.id === storyId) : s);
      setCases(c);
      const ids = preKey ? preKey.split(",") : c.filter((x) => x.enabled && x.automation !== "manual").map((x) => x.id);
      setSelected(new Set(ids));
    });
  }, [open, project.id, preKey, storyId]);

  const groups = useMemo(() => stories.map((s) => ({ story: s, cases: cases.filter((c) => c.story_id === s.id) })).filter((g) => g.cases.length), [stories, cases]);
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setSelected(next);
  };
  const checks = cases.filter((c) => selected.has(c.id)).reduce((a, c) => a + c.checks.length, 0);

  const start = () =>
    run("start", async () => {
      const r = await api.post<Run>("/runs", { projectId: project.id, buildId: buildId || null, device, testCaseIds: [...selected] });
      navigate(`/runs/${r.id}`);
    });

  return (
    <Modal open={open} onClose={onClose} title="Start a test run" subtitle="Claude executes each test case in a real browser and audits every screen for front-end issues." size="lg">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Build" hint={builds.length ? undefined : "No builds yet — the run uses the project site URL."}>
          <select className="input" value={buildId} onChange={(e) => setBuildId(e.target.value)}>
            <option value="">No build (project site URL)</option>
            {builds.map((b) => <option key={b.id} value={b.id}>{b.version}{b.branch ? ` · ${b.branch}` : ""}{b.site_url ? ` · ${b.site_url}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Device">
          <select className="input" value={device} onChange={(e) => setDevice(e.target.value)}>
            {devices.map((d) => <option key={d}>{d}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-5 max-h-[48vh] space-y-5 overflow-y-auto rounded-xl border border-slate-200 p-4">
        {groups.map(({ story, cases }) => {
          const allOn = cases.every((c) => selected.has(c.id));
          return (
            <div key={story.id}>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={allOn} onChange={(e) => toggle(cases.map((c) => c.id), e.target.checked)} />
                {story.title}
              </label>
              <div className="ml-6 mt-2 space-y-1.5">
                {cases.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.has(c.id)} onChange={(e) => toggle([c.id], e.target.checked)} />
                    <span className="font-mono text-xs text-slate-400">{c.code}</span>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {c.automation !== "auto" && <Badge value={c.automation} />}
                    {c.checks.length > 0 && <span className="text-xs text-slate-400">{c.checks.length} checks</span>}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        {!groups.length && <p className="text-sm text-slate-500">No test cases yet. Open a story and generate or import test cases first.</p>}
      </div>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-500"><b className="text-slate-900">{selected.size}</b> test case(s) · {checks} checks</span>
        <button className="btn-primary" disabled={!selected.size || busy === "start"} onClick={start}>
          {busy === "start" ? <Spinner /> : <Play className="h-4 w-4" />} Start run
        </button>
      </div>
    </Modal>
  );
}
