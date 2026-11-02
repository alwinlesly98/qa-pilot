import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BookOpen, Bug, Code2, ExternalLink, Package, Play, PlayCircle, RefreshCw, Settings2, Trash2, Code } from "lucide-react";
import { api } from "../lib/api";
import type { Project } from "../lib/types";
import { BuildsTab, IssuesTab, RunsList, StoriesList } from "../components/ProjectTabs";
import AutomationTab from "../components/AutomationTab";
import ProjectForm from "../components/ProjectForm";
import NewRunModal from "../components/NewRunModal";
import { PageHeader, Spinner, Tabs, timeAgo, useAction, useToast } from "../components/ui";
import { PROJECTS_CHANGED } from "../App";

type TabKey = "stories" | "runs" | "issues" | "automation" | "builds" | "settings";

function AppContextCard({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const [text, setText] = useState(project.app_context ?? "");
  const { busy, run } = useAction();
  useEffect(() => setText(project.app_context ?? ""), [project.app_context]);
  return (
    <div className="card p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-slate-900"><Code className="h-4 w-4 text-brand-600" /> Application knowledge</h3>
          <p className="mt-1 text-sm text-slate-500">
            What Claude knows about the app (routes, forms, test ids). Used for writing and executing tests. Edit freely.
            {project.app_context_updated_at && ` Last analysed ${timeAgo(project.app_context_updated_at)}.`}
          </p>
        </div>
        <button className="btn-secondary" disabled={!project.git_url || !!busy} onClick={() => run("analyze", async () => onChange(await api.post<Project>(`/projects/${project.id}/analyze-repo`)), "Repository analysed")}>
          {busy === "analyze" ? <><Spinner /> Cloning & analysing…</> : <><RefreshCw className="h-4 w-4" /> Analyse repository</>}
        </button>
      </div>
      <textarea className="input mt-4 min-h-[220px] font-mono text-[13px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={project.git_url ? "Click 'Analyse repository' or describe the app yourself." : "Add a Git URL above, or describe pages, menus and key forms here yourself."} />
      <div className="mt-3 flex justify-end">
        <button className="btn-primary" disabled={text === (project.app_context ?? "") || busy === "save"} onClick={() => run("save", async () => onChange(await api.put<Project>(`/projects/${project.id}`, { app_context: text })), "Saved")}>
          Save knowledge
        </button>
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey) || "stories";
  const [project, setProject] = useState<Project | null>(null);
  const [runOpen, setRunOpen] = useState(false);

  const load = useCallback(() => api.get<Project>(`/projects/${id}`).then(setProject).catch(() => navigate("/")), [id, navigate]);
  useEffect(() => void load(), [load]);

  if (!project) return <Spinner className="h-6 w-6 text-slate-400" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        subtitle={
          <a href={project.site_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand-600">
            {project.site_url} <ExternalLink className="h-3 w-3" />
          </a>
        }
        actions={<button className="btn-primary" onClick={() => setRunOpen(true)}><Play className="h-4 w-4" /> Run tests</button>}
      />

      <Tabs<TabKey>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { key: "stories", label: "Stories", icon: <BookOpen className="h-4 w-4" /> },
          { key: "runs", label: "Runs", icon: <PlayCircle className="h-4 w-4" /> },
          { key: "issues", label: "Issues", icon: <Bug className="h-4 w-4" /> },
          { key: "automation", label: "Playwright", icon: <Code2 className="h-4 w-4" /> },
          { key: "builds", label: "Builds", icon: <Package className="h-4 w-4" /> },
          { key: "settings", label: "Settings", icon: <Settings2 className="h-4 w-4" /> },
        ]}
      />

      {tab === "stories" && <StoriesList project={project} />}
      {tab === "runs" && <RunsList projectId={project.id} onRun={() => setRunOpen(true)} />}
      {tab === "issues" && <IssuesTab project={project} />}
      {tab === "automation" && <AutomationTab project={project} />}
      {tab === "builds" && <BuildsTab project={project} onRun={() => setRunOpen(true)} />}
      {tab === "settings" && (
        <div className="space-y-6">
          <ProjectForm
            key={project.id}
            project={project}
            submitLabel="Save changes"
            onSubmit={async (v) => {
              try {
                setProject(await api.put<Project>(`/projects/${project.id}`, v));
                window.dispatchEvent(new Event(PROJECTS_CHANGED));
                toast("success", "Project saved");
              } catch (e) {
                toast("error", (e as Error).message);
              }
            }}
          />
          <AppContextCard project={project} onChange={setProject} />
          <div className="card flex items-center justify-between border-red-200 p-6">
            <div>
              <div className="font-semibold text-red-700">Delete project</div>
              <div className="text-sm text-slate-500">Removes stories, test cases, runs, specs and issues. Jira tickets are not touched.</div>
            </div>
            <button
              className="btn-danger"
              onClick={async () => {
                if (!confirm(`Delete ${project.name}?`)) return;
                await api.del(`/projects/${project.id}`);
                window.dispatchEvent(new Event(PROJECTS_CHANGED));
                navigate("/");
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </div>
      )}

      <NewRunModal project={project} open={runOpen} onClose={() => setRunOpen(false)} />
    </div>
  );
}
