import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FileSpreadsheet, ListChecks, Play, PlayCircle, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { Project, Story, TestCase } from "../lib/types";
import StoryAnalysis from "../components/StoryAnalysis";
import TestCaseTable from "../components/TestCaseTable";
import { ExportSheetModal, ImportSheetModal } from "../components/SheetModals";
import { RunsList, coveragePct } from "../components/ProjectTabs";
import NewRunModal from "../components/NewRunModal";
import { Badge, PageHeader, Spinner, Tabs, useAction } from "../components/ui";

type TabKey = "analysis" | "cases" | "runs";

export default function StoryPage() {
  const { pid, sid } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey) || "analysis";
  const [project, setProject] = useState<Project | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [runOpen, setRunOpen] = useState<string[] | null>(null);
  const [genReq, setGenReq] = useState<{ guidance: string; n: number } | null>(null);
  const { run } = useAction();
  const autoAnalyze = params.get("analyze") === "1";

  const loadCases = useCallback(async () => {
    const [c, s] = await Promise.all([api.get<TestCase[]>(`/stories/${sid}/testcases`), api.get<Story>(`/stories/${sid}`)]);
    setCases(c);
    setStory(s);
  }, [sid]);

  useEffect(() => {
    api.get<Project>(`/projects/${pid}`).then(setProject).catch(() => navigate("/"));
    void loadCases();
  }, [pid, navigate, loadCases]);

  if (!project || !story) return <Spinner className="h-6 w-6 text-slate-400" />;
  const pct = coveragePct(story);
  const setTab = (t: TabKey) => setParams({ tab: t });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Link to={`/projects/${project.id}`} className="hover:text-brand-600">← {project.name}</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{story.title}{story.jira_key && <Badge tone="blue">{story.jira_key}</Badge>}</span>}
        subtitle={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span>{story.requirements.length} requirements</span>
            <span>{cases.length} test cases · {cases.reduce((a, c) => a + c.checks.length, 0)} checks</span>
            {pct != null && <span className={pct === 100 ? "text-emerald-600" : "text-amber-600"}>{pct}% requirement coverage</span>}
            {story.review.length > 0 && <span className="text-red-600">{story.review.length} story issues</span>}
          </span>
        }
        actions={
          <>
            <button className="btn-ghost text-red-600" title="Delete story" onClick={() => confirm("Delete this story and its test cases?") && run("del", async () => { await api.del(`/stories/${story.id}`); navigate(`/projects/${project.id}`); })}>
              <Trash2 className="h-4 w-4" />
            </button>
            <button className="btn-secondary" disabled={!cases.length} onClick={() => setExportOpen(true)}><FileSpreadsheet className="h-4 w-4" /> Export Excel</button>
            <button className="btn-primary" disabled={!cases.length} onClick={() => setRunOpen([])}><Play className="h-4 w-4" /> Run tests</button>
          </>
        }
      />

      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "analysis", label: "Story & requirements", icon: <ListChecks className="h-4 w-4" />, count: story.review.length || undefined },
          { key: "cases", label: "Test cases", icon: <FileSpreadsheet className="h-4 w-4" />, count: cases.length },
          { key: "runs", label: "Runs & results", icon: <PlayCircle className="h-4 w-4" /> },
        ]}
      />

      {tab === "analysis" && (
        <StoryAnalysis
          story={story}
          onChange={(s) => { setStory(s); void loadCases(); }}
          autoAnalyze={autoAnalyze}
          onGenerate={(guidance) => { setTab("cases"); setGenReq({ guidance, n: Date.now() }); }}
        />
      )}
      {tab === "cases" && (
        <TestCaseTable story={story} cases={cases} reload={loadCases} onRun={(ids) => setRunOpen(ids)} onImport={() => setImportOpen(true)} onExport={() => setExportOpen(true)} generateRequest={genReq} />
      )}
      {tab === "runs" && <RunsList projectId={project.id} storyId={story.id} onRun={() => setRunOpen([])} />}

      <ImportSheetModal story={story} open={importOpen} onClose={() => setImportOpen(false)} onImported={() => { setTab("cases"); void loadCases(); }} />
      <ExportSheetModal story={story} projectId={project.id} open={exportOpen} onClose={() => setExportOpen(false)} />
      <NewRunModal project={project} storyId={story.id} open={runOpen !== null} onClose={() => setRunOpen(null)} preselect={runOpen?.length ? runOpen : undefined} />
    </div>
  );
}
